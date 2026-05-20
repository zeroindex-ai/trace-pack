import { describe, expect, it } from 'vitest';
import { fmtMs } from './format';

describe('fmtMs', () => {
  it('renders nullish as an em-dash', () => {
    expect(fmtMs(null)).toBe('—');
    expect(fmtMs(undefined)).toBe('—');
  });

  it('renders sub-1000ms values in milliseconds', () => {
    expect(fmtMs(0)).toBe('0ms');
    expect(fmtMs(142)).toBe('142ms');
    expect(fmtMs(999)).toBe('999ms');
  });

  it('switches to seconds at the 1000ms boundary', () => {
    expect(fmtMs(1000)).toBe('1.00s');
    expect(fmtMs(4730)).toBe('4.73s');
    expect(fmtMs(12040)).toBe('12.04s');
  });
});
