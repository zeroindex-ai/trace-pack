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
  return `${n}ms`;
}

export function fmtHash(h: string): string {
  return h.slice(0, 8);
}
