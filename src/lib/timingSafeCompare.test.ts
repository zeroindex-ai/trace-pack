import { describe, expect, it } from 'vitest';
import { safeEqual } from './timingSafeCompare';

describe('safeEqual', () => {
  it('returns true for equal strings', () => {
    expect(safeEqual('hunter2', 'hunter2')).toBe(true);
  });

  it('returns false for different equal-length strings', () => {
    expect(safeEqual('hunter2', 'hunter3')).toBe(false);
  });

  it('returns false for different-length strings without throwing', () => {
    expect(() => safeEqual('short', 'longer-string')).not.toThrow();
    expect(safeEqual('short', 'longer-string')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});
