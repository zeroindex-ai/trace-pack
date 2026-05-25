export function utcDayOffset(n: number, now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n));
  return d.toISOString().slice(0, 10);
}

export function yesterdayUtc(now: Date = new Date()): string {
  return utcDayOffset(1, now);
}

export function lastNDays(days: number, now: Date = new Date()): string[] {
  return Array.from({ length: days }, (_, i) => utcDayOffset(days - 1 - i, now));
}

// Half-open interval [startIso, nextDayStartIso): use as `ts >= startIso AND ts
// < nextDayStartIso`. The upper bound is the start of the FOLLOWING day, which
// avoids the millisecond off-by-one an inclusive `ts <= 23:59:59.999` bound has
// (it would drop sub-millisecond timestamps in that final millisecond).
export function dayBounds(day: string): { startIso: string; nextDayStartIso: string } {
  const start = new Date(`${day}T00:00:00.000Z`);
  const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    nextDayStartIso: next.toISOString(),
  };
}

// Half-open interval [startIso, nextDayStartIso) spanning a day window: the
// upper bound is the start of the day AFTER the last day, so use it as
// `ts >= startIso AND ts < nextDayStartIso` (same off-by-one fix as dayBounds).
export function windowBounds(days: string[]): { startIso: string; nextDayStartIso: string } {
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('windowBounds requires a non-empty day window');
  }
  return { startIso: dayBounds(first).startIso, nextDayStartIso: dayBounds(last).nextDayStartIso };
}
