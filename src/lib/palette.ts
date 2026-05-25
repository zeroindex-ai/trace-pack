/**
 * Color tokens shared between CSS and Recharts.
 * Mirrors the :root custom properties in app/globals.css, which mirror
 * zeroindex-site/STYLE_GUIDE.md §1 (with two dashboard-only extensions).
 */
export const palette = {
  ink: '#18181b',
  muted: '#52525b',
  muted2: '#71717a',
  line: '#cfc9bd',
  lineStrong: '#9c958a',
  accent1: '#7c3aed',
  accent2: '#4f46e5',
  accent3: '#c026d3',
  accentGo: '#16a34a',
  // dashboard-only state colors — outcome semantics demand more than the
  // marketing palette carries. Tuned to sit on the cream --bg.
  warn: '#b45309',
  error: '#be123c',
} as const;

export const chartColors = {
  primary: palette.accent1,
  ok: palette.accentGo,
  error: palette.error,
  retrievalFailed: palette.warn,
  streamFailed: palette.error,
  aborted: palette.muted2,
  p50: palette.accent2,
  p95: palette.accent1,
  p99: palette.accent3,
  grid: palette.line,
  axis: palette.muted,
} as const;
