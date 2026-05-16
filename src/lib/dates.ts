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

export function dayBounds(day: string): { startIso: string; endIso: string } {
  return {
    startIso: `${day}T00:00:00.000Z`,
    endIso: `${day}T23:59:59.999Z`,
  };
}

export function windowBounds(days: string[]): { startIso: string; endIso: string } {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return { startIso: `${first}T00:00:00.000Z`, endIso: `${last}T23:59:59.999Z` };
}
