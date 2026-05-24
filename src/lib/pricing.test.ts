import { describe, it, expect } from 'vitest';
import { costOf, priceFor } from './pricing';

describe('priceFor', () => {
  it('matches a bare family id', () => {
    expect(priceFor('claude-sonnet-4-6')).toEqual({ inputPer1M: 3, outputPer1M: 15 });
  });

  it('matches a dated/suffixed id by substring', () => {
    expect(priceFor('claude-opus-4-1-20250805')).toEqual({ inputPer1M: 15, outputPer1M: 75 });
  });

  it('is case-insensitive', () => {
    expect(priceFor('Claude-Sonnet-4-6')).toEqual({ inputPer1M: 3, outputPer1M: 15 });
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
