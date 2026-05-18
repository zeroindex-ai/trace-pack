import type { Client } from '@libsql/client';
import { dayBounds, yesterdayUtc } from '@/lib/dates';
import { safeEqual } from '@/lib/timingSafeCompare';
import { OUTCOMES, type Outcome } from '@/ingest/schema';

export { yesterdayUtc } from '@/lib/dates';

export type RollupSummary = {
  source: string;
  day: string;
  events: number;
  ok: number;
  retrieval_failed: number;
  stream_failed: number;
  aborted: number;
  p50_total_ms: number | null;
  p95_total_ms: number | null;
  p99_total_ms: number | null;
  p50_first_token_ms: number | null;
  p95_first_token_ms: number | null;
  p99_first_token_ms: number | null;
  avg_citations: number | null;
};

export function percentile(values: ReadonlyArray<number>, p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(Math.max(0, Math.ceil(p * sorted.length) - 1), sorted.length - 1);
  return sorted[idx] ?? null;
}

function emptyOutcomeCounts(): Record<Outcome, number> {
  return { ok: 0, retrieval_failed: 0, stream_failed: 0, aborted: 0 };
}

async function sourcesForDay(client: Client, day: string): Promise<string[]> {
  const { startIso, endIso } = dayBounds(day);
  const res = await client.execute({
    sql: 'SELECT DISTINCT source FROM events WHERE ts >= ? AND ts <= ? ORDER BY source',
    args: [startIso, endIso],
  });
  return res.rows.map((r) => String(r.source));
}

async function aggregateSource(client: Client, source: string, day: string): Promise<RollupSummary | null> {
  const { startIso, endIso } = dayBounds(day);
  const res = await client.execute({
    sql: `SELECT outcome, total_ms, first_token_ms, citation_count
          FROM events
          WHERE source = ? AND ts >= ? AND ts <= ?`,
    args: [source, startIso, endIso],
  });
  if (res.rows.length === 0) return null;

  const totals: number[] = [];
  const firstTokens: number[] = [];
  const citations: number[] = [];
  const counts = emptyOutcomeCounts();

  for (const row of res.rows) {
    const outcome = String(row.outcome);
    if ((OUTCOMES as readonly string[]).includes(outcome)) counts[outcome as Outcome] += 1;
    if (row.total_ms != null) totals.push(Number(row.total_ms));
    if (row.first_token_ms != null) firstTokens.push(Number(row.first_token_ms));
    if (row.citation_count != null) citations.push(Number(row.citation_count));
  }

  const avg = citations.length === 0 ? null : citations.reduce((a, b) => a + b, 0) / citations.length;

  return {
    source,
    day,
    events: res.rows.length,
    ok: counts.ok,
    retrieval_failed: counts.retrieval_failed,
    stream_failed: counts.stream_failed,
    aborted: counts.aborted,
    p50_total_ms: percentile(totals, 0.5),
    p95_total_ms: percentile(totals, 0.95),
    p99_total_ms: percentile(totals, 0.99),
    p50_first_token_ms: percentile(firstTokens, 0.5),
    p95_first_token_ms: percentile(firstTokens, 0.95),
    p99_first_token_ms: percentile(firstTokens, 0.99),
    avg_citations: avg,
  };
}

async function writeRollup(client: Client, r: RollupSummary): Promise<void> {
  await client.execute({
    sql: `INSERT OR REPLACE INTO rollup_daily (
      source, day, events, ok, retrieval_failed, stream_failed, aborted,
      p50_total_ms, p95_total_ms, p99_total_ms,
      p50_first_token_ms, p95_first_token_ms, p99_first_token_ms,
      avg_citations
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      r.source,
      r.day,
      r.events,
      r.ok,
      r.retrieval_failed,
      r.stream_failed,
      r.aborted,
      r.p50_total_ms,
      r.p95_total_ms,
      r.p99_total_ms,
      r.p50_first_token_ms,
      r.p95_first_token_ms,
      r.p99_first_token_ms,
      r.avg_citations,
    ],
  });
}

export async function rollupDay(client: Client, day: string): Promise<RollupSummary[]> {
  const sources = await sourcesForDay(client, day);
  const summaries: RollupSummary[] = [];
  for (const source of sources) {
    const summary = await aggregateSource(client, source, day);
    if (summary !== null) {
      await writeRollup(client, summary);
      summaries.push(summary);
    }
  }
  return summaries;
}

function bearerMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  return safeEqual(expected, provided);
}

export async function handleRollup(client: Client, req: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return Response.json({ error: 'cron_secret_not_configured' }, { status: 500 });
  }
  if (!bearerMatches(req.headers.get('authorization'), `Bearer ${expected}`)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const day = url.searchParams.get('day') ?? yesterdayUtc();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: 'invalid_day' }, { status: 400 });
  }
  try {
    const sources = await rollupDay(client, day);
    return Response.json({ day, sources });
  } catch (err) {
    console.error('trace-pack rollup failed:', err);
    return Response.json({ error: 'rollup_failed' }, { status: 500 });
  }
}
