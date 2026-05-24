export function fmtTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  // Canonical admin date format across ZeroIndex services — matches
  // intake-zero/app/admin (YYYY-MM-DD HH:MM, no seconds, no Z, space
  // separator). ISO strings are already UTC; truncating at index 16
  // drops the seconds + tz suffix.
  return iso.slice(0, 16).replace('T', ' ');
}

export function fmtMs(n: number | null | undefined): string {
  if (n == null) return '—';
  // Sub-second latencies read best in raw ms; once we cross 1000ms the
  // headline dashboard is more legible in seconds (e.g. "4.73s" over
  // "4730ms"). Two decimal places keep the precision a latency p99 needs.
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  return `${n}ms`;
}

export function fmtHash(h: string): string {
  return h.slice(0, 8);
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '$0';
  // Sub-dollar spend (typical per-day for a small app) needs more precision than
  // cents; once we cross $1 two decimals read cleanly.
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export function fmtPct(rate: number | null | undefined): string {
  if (rate == null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}
