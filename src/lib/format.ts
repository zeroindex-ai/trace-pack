export function fmtTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.replace(/\.\d{3}Z$/, 'Z');
}

export function fmtMs(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n}ms`;
}

export function fmtHash(h: string): string {
  return h.slice(0, 8);
}
