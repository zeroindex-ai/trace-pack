import { describe, it, expect } from 'vitest';
import { dayBounds, windowBounds } from './dates';

describe('dayBounds', () => {
  it('starts at midnight UTC of the day', () => {
    expect(dayBounds('2026-05-14').startIso).toBe('2026-05-14T00:00:00.000Z');
  });

  it('returns a half-open interval whose upper bound is the start of the next day', () => {
    // The off-by-one fix: the upper bound is the FOLLOWING day's midnight, used
    // with `ts < nextDayStartIso` (not an inclusive `ts <= 23:59:59.999`).
    expect(dayBounds('2026-05-14').nextDayStartIso).toBe('2026-05-15T00:00:00.000Z');
  });

  it('rolls over month boundaries', () => {
    expect(dayBounds('2026-05-31').nextDayStartIso).toBe('2026-06-01T00:00:00.000Z');
  });

  it('rolls over year boundaries', () => {
    expect(dayBounds('2026-12-31').nextDayStartIso).toBe('2027-01-01T00:00:00.000Z');
  });

  // The two boundary cases that motivated the half-open conversion. Modelled as
  // a `ts >= startIso AND ts < nextDayStartIso` membership check, exactly how the
  // queries thread these bounds into SQL.
  const inDay = (ts: string, day: string) => {
    const { startIso, nextDayStartIso } = dayBounds(day);
    return ts >= startIso && ts < nextDayStartIso;
  };

  it('includes an event at 23:59:59.999 (the last representable instant of the day)', () => {
    expect(inDay('2026-05-14T23:59:59.999Z', '2026-05-14')).toBe(true);
  });

  it('excludes an event at exactly the next day start (the half-open upper bound)', () => {
    // Under the old inclusive `ts <= 23:59:59.999` bound this instant was already
    // excluded — but a timestamp with sub-millisecond precision in the final
    // millisecond (e.g. 23:59:59.9995) would have been wrongly dropped. The
    // half-open bound includes everything strictly before the next day's start.
    expect(inDay('2026-05-15T00:00:00.000Z', '2026-05-14')).toBe(false);
  });

  it('includes the very first instant of the day', () => {
    expect(inDay('2026-05-14T00:00:00.000Z', '2026-05-14')).toBe(true);
  });

  it('excludes the last instant of the previous day', () => {
    expect(inDay('2026-05-13T23:59:59.999Z', '2026-05-14')).toBe(false);
  });
});

describe('windowBounds', () => {
  it('spans from the first day start to the start of the day after the last day', () => {
    const { startIso, nextDayStartIso } = windowBounds(['2026-05-10', '2026-05-11', '2026-05-14']);
    expect(startIso).toBe('2026-05-10T00:00:00.000Z');
    expect(nextDayStartIso).toBe('2026-05-15T00:00:00.000Z');
  });

  it('handles a single-day window', () => {
    const { startIso, nextDayStartIso } = windowBounds(['2026-05-14']);
    expect(startIso).toBe('2026-05-14T00:00:00.000Z');
    expect(nextDayStartIso).toBe('2026-05-15T00:00:00.000Z');
  });

  const inWindow = (ts: string, days: string[]) => {
    const { startIso, nextDayStartIso } = windowBounds(days);
    return ts >= startIso && ts < nextDayStartIso;
  };

  it('includes 23:59:59.999 of the last day and excludes the next day start', () => {
    const days = ['2026-05-13', '2026-05-14'];
    expect(inWindow('2026-05-14T23:59:59.999Z', days)).toBe(true);
    expect(inWindow('2026-05-15T00:00:00.000Z', days)).toBe(false);
  });

  it('throws on an empty window', () => {
    expect(() => windowBounds([])).toThrow('windowBounds requires a non-empty day window');
  });
});
