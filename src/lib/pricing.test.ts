import { describe, it, expect } from 'vitest';
import { costOf, priceFor } from './pricing';

describe('priceFor', () => {
  it('matches a bare family id', () => {
    expect(priceFor('claude-sonnet-4-6')).toEqual({ inputPer1M: 3, outputPer1M: 15 });
  });

  it('matches a dated/suffixed id by substring', () => {
    expect(priceFor('claude-opus-4-1-20250805')).toEqual({ inputPer1M: 15, outputPer1M: 75 });
  });

  it('prices current-gen Opus (4.5+) at the dropped $5/$25 rate, legacy Opus 4.0/4.1 at $15/$75', () => {
    expect(priceFor('claude-opus-4-7')).toEqual({ inputPer1M: 5, outputPer1M: 25 });
    expect(priceFor('claude-opus-4-6')).toEqual({ inputPer1M: 5, outputPer1M: 25 });
    expect(priceFor('claude-opus-4-5')).toEqual({ inputPer1M: 5, outputPer1M: 25 });
    expect(priceFor('claude-opus-4-1')).toEqual({ inputPer1M: 15, outputPer1M: 75 });
  });

  it('is case-insensitive', () => {
    expect(priceFor('Claude-Sonnet-4-6')).toEqual({ inputPer1M: 3, outputPer1M: 15 });
  });

  it('longest match wins — a specific id is not shadowed by a broader prefix', () => {
    // Both 'claude-opus-4' ($15/$75) and 'claude-opus-4-5' ($5/$25) match this
    // id by substring. The most-specific (longest) key must win regardless of
    // table order. Under the old first-match-wins logic this would resolve to
    // $15/$75 if the broad 'claude-opus-4' key were listed first.
    expect(priceFor('claude-opus-4-5-20260101')).toEqual({ inputPer1M: 5, outputPer1M: 25 });
    expect(priceFor('claude-opus-4-6')).toEqual({ inputPer1M: 5, outputPer1M: 25 });
    // The broad prefix still applies to the legacy ids it is meant to cover.
    expect(priceFor('claude-opus-4-0')).toEqual({ inputPer1M: 15, outputPer1M: 75 });
    expect(priceFor('claude-opus-4-1')).toEqual({ inputPer1M: 15, outputPer1M: 75 });
  });

  it('returns null for an unknown model', () => {
    expect(priceFor('gpt-4o')).toBeNull();
    expect(priceFor(null)).toBeNull();
    expect(priceFor(undefined)).toBeNull();
  });
});

describe('costOf', () => {
  it('prices input + output at the model rate', () => {
    // 1M input @ $3 + 1M output @ $15 = $18.
    expect(costOf('claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(18);
  });

  it('applies the cache write (1.25×) and read (0.1×) multipliers off the input rate', () => {
    // 1M cache-write @ 3 × 1.25 = $3.75; 1M cache-read @ 3 × 0.1 = $0.30.
    expect(costOf('claude-sonnet-4-6', { cacheCreationInputTokens: 1_000_000 })).toBe(3.75);
    expect(costOf('claude-sonnet-4-6', { cacheReadInputTokens: 1_000_000 })).toBe(0.3);
  });

  it('sums all four token classes', () => {
    // 3 (in) + 15 (out) + 3.75 (write) + 0.30 (read) = 22.05.
    expect(
      costOf('claude-sonnet-4-6', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheCreationInputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
      })
    ).toBe(22.05);
  });

  it('returns null for an unknown model (visible gap, not a fake $0)', () => {
    expect(costOf('gpt-4o', { inputTokens: 1000, outputTokens: 1000 })).toBeNull();
  });

  it('returns null when no tokens are present', () => {
    expect(costOf('claude-sonnet-4-6', {})).toBeNull();
    expect(costOf('claude-sonnet-4-6', { inputTokens: null, outputTokens: null })).toBeNull();
  });
});
