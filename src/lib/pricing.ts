// Anthropic API list prices, USD per 1M tokens. Source: Anthropic pricing page.
//
// PRICES_AS_OF below is the date these were last checked — VERIFY before trusting
// the absolute numbers. Cost is computed at ingest and STORED (design §3), so an
// edit here is non-retroactive: it affects new events only. An unknown model
// yields a null cost (a visible gap), never a misleading $0.
export const PRICES_AS_OF = '2026-05-24';

type ModelPrice = { inputPer1M: number; outputPer1M: number };

// Matched by substring against the lowercased model id, most specific first, so
// dated/suffixed ids ('claude-sonnet-4-6', 'claude-sonnet-4-6-20250219', …) resolve.
// Opus 4.5 dropped the Opus rate to $5/$25; 4.0/4.1 stay at the original $15/$75,
// so the current-gen ids must be listed BEFORE the 'claude-opus-4' catch-all.
const PRICES: ReadonlyArray<readonly [match: string, price: ModelPrice]> = [
  ['claude-opus-4-5', { inputPer1M: 5, outputPer1M: 25 }],
  ['claude-opus-4-6', { inputPer1M: 5, outputPer1M: 25 }],
  ['claude-opus-4-7', { inputPer1M: 5, outputPer1M: 25 }],
  ['claude-opus-4', { inputPer1M: 15, outputPer1M: 75 }], // Opus 4.0 / 4.1 (pre-price-drop)
  ['claude-sonnet-4', { inputPer1M: 3, outputPer1M: 15 }],
  ['claude-haiku-4', { inputPer1M: 1, outputPer1M: 5 }],
  ['claude-3-7-sonnet', { inputPer1M: 3, outputPer1M: 15 }],
  ['claude-3-5-sonnet', { inputPer1M: 3, outputPer1M: 15 }],
  ['claude-3-5-haiku', { inputPer1M: 0.8, outputPer1M: 4 }],
  ['claude-3-opus', { inputPer1M: 15, outputPer1M: 75 }],
  ['claude-3-haiku', { inputPer1M: 0.25, outputPer1M: 1.25 }],
];

// Prompt-caching multipliers on the base input rate (Anthropic standard):
// writing to cache costs 1.25×, reading from cache 0.1×.
const CACHE_WRITE_MULT = 1.25;
const CACHE_READ_MULT = 0.1;

export type TokenUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
};

export function priceFor(model: string | null | undefined): ModelPrice | null {
  if (!model) return null;
  const id = model.toLowerCase();
  for (const [match, price] of PRICES) {
    if (id.includes(match)) return price;
  }
  return null;
}

// USD cost for one request, or null when the model is unknown or no tokens are
// present. Anthropic's `input_tokens` already excludes cached tokens, so the
// cache classes are priced as separate addends off the base input rate.
export function costOf(model: string | null | undefined, usage: TokenUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;

  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  if (input === 0 && output === 0 && cacheWrite === 0 && cacheRead === 0) return null;

  const inRate = price.inputPer1M / 1_000_000;
  const outRate = price.outputPer1M / 1_000_000;
  const cost =
    input * inRate +
    cacheWrite * inRate * CACHE_WRITE_MULT +
    cacheRead * inRate * CACHE_READ_MULT +
    output * outRate;

  // 6 dp — sub-micro-dollar precision is noise.
  return Math.round(cost * 1e6) / 1e6;
}
