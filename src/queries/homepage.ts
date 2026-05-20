import type { Client } from '@libsql/client';
import { dayBounds, lastNDays, windowBounds } from '@/lib/dates';
import { OUTCOMES, type Outcome } from '@/ingest/schema';
import { percentile } from './rollup';

export { lastNDays } from '@/lib/dates';

export type DailyTraffic = { day: string; events: number };
export type DailyOutcomes = {
  day: string;
  ok: number;
  retrieval_failed: number;
  stream_failed: number;
  aborted: number;
};
export type DailyLatency = {
  day: string;
  p50_total_ms: number | null;
  p95_total_ms: number | null;
  p99_total_ms: number | null;
  p50_first_token_ms: number | null;
  p95_first_token_ms: number | null;
  p99_first_token_ms: number | null;
};
export type CitationBucket = { count: number; frequency: number };
export type RetrievedIdRow = { chunkId: number; count: number };

function emptyOutcomes(): Record<Outcome, number> {
  return { ok: 0, retrieval_failed: 0, stream_failed: 0, aborted: 0 };
}

// Returns the first and last day of a non-empty window. Throws on an empty
// window rather than emitting `undefined` into SQL bounds.
function windowEdges(window: string[]): { first: string; today: string } {
  const first = window[0];
  const today = window[window.length - 1];
  if (first === undefined || today === undefined) {
    throw new Error('day window must contain at least one day');
  }
  return { first, today };
}

export async function dailyTraffic(
  client: Client,
  source: string,
  days: number,
  now: Date = new Date()
): Promise<DailyTraffic[]> {
  const window = lastNDays(days, now);
  const { first, today } = windowEdges(window);

  const rollup = await client.execute({
    sql: 'SELECT day, events FROM rollup_daily WHERE source = ? AND day >= ? AND day < ?',
    args: [source, first, today],
  });
  const byDay = new Map<string, number>();
  for (const r of rollup.rows) byDay.set(String(r.day), Number(r.events));

  const { startIso, endIso } = dayBounds(today);
  const todayRow = await client.execute({
    sql: 'SELECT COUNT(*) AS n FROM events WHERE source = ? AND ts >= ? AND ts <= ?',
    args: [source, startIso, endIso],
  });
  byDay.set(today, Number(todayRow.rows[0]?.n ?? 0));

  return window.map((d) => ({ day: d, events: byDay.get(d) ?? 0 }));
}

export async function dailyOutcomes(
  client: Client,
  source: string,
  days: number,
  now: Date = new Date()
): Promise<DailyOutcomes[]> {
  const window = lastNDays(days, now);
  const { first, today } = windowEdges(window);

  const rollup = await client.execute({
    sql: `SELECT day, ok, retrieval_failed, stream_failed, aborted
          FROM rollup_daily WHERE source = ? AND day >= ? AND day < ?`,
    args: [source, first, today],
  });
  const byDay = new Map<string, DailyOutcomes>();
  for (const r of rollup.rows) {
    byDay.set(String(r.day), {
      day: String(r.day),
      ok: Number(r.ok),
      retrieval_failed: Number(r.retrieval_failed),
      stream_failed: Number(r.stream_failed),
      aborted: Number(r.aborted),
    });
  }

  const { startIso, endIso } = dayBounds(today);
  const todayRows = await client.execute({
    sql: `SELECT outcome, COUNT(*) AS n FROM events
          WHERE source = ? AND ts >= ? AND ts <= ? GROUP BY outcome`,
    args: [source, startIso, endIso],
  });
  const todayCounts = emptyOutcomes();
  for (const r of todayRows.rows) {
    const o = String(r.outcome);
    if ((OUTCOMES as readonly string[]).includes(o)) {
      todayCounts[o as Outcome] = Number(r.n);
    }
  }
  byDay.set(today, { day: today, ...todayCounts });

  return window.map((d) => byDay.get(d) ?? { day: d, ...emptyOutcomes() });
}

export async function dailyLatencies(
  client: Client,
  source: string,
  days: number,
  now: Date = new Date()
): Promise<DailyLatency[]> {
  const window = lastNDays(days, now);
  const { first, today } = windowEdges(window);

  const rollup = await client.execute({
    sql: `SELECT day, p50_total_ms, p95_total_ms, p99_total_ms,
                 p50_first_token_ms, p95_first_token_ms, p99_first_token_ms
          FROM rollup_daily WHERE source = ? AND day >= ? AND day < ?`,
    args: [source, first, today],
  });
  const byDay = new Map<string, DailyLatency>();
  for (const r of rollup.rows) {
    const num = (key: string) => (r[key] == null ? null : Number(r[key]));
    byDay.set(String(r.day), {
      day: String(r.day),
      p50_total_ms: num('p50_total_ms'),
      p95_total_ms: num('p95_total_ms'),
      p99_total_ms: num('p99_total_ms'),
      p50_first_token_ms: num('p50_first_token_ms'),
      p95_first_token_ms: num('p95_first_token_ms'),
      p99_first_token_ms: num('p99_first_token_ms'),
    });
  }

  const { startIso, endIso } = dayBounds(today);
  const todayRows = await client.execute({
    sql: 'SELECT total_ms, first_token_ms FROM events WHERE source = ? AND ts >= ? AND ts <= ?',
    args: [source, startIso, endIso],
  });
  const totals: number[] = [];
  const firstTokens: number[] = [];
  for (const r of todayRows.rows) {
    if (r.total_ms != null) totals.push(Number(r.total_ms));
    if (r.first_token_ms != null) firstTokens.push(Number(r.first_token_ms));
  }
  byDay.set(today, {
    day: today,
    p50_total_ms: percentile(totals, 0.5),
    p95_total_ms: percentile(totals, 0.95),
    p99_total_ms: percentile(totals, 0.99),
    p50_first_token_ms: percentile(firstTokens, 0.5),
    p95_first_token_ms: percentile(firstTokens, 0.95),
    p99_first_token_ms: percentile(firstTokens, 0.99),
  });

  return window.map(
    (d) =>
      byDay.get(d) ?? {
        day: d,
        p50_total_ms: null,
        p95_total_ms: null,
        p99_total_ms: null,
        p50_first_token_ms: null,
        p95_first_token_ms: null,
        p99_first_token_ms: null,
      }
  );
}

export async function citationHistogram(
  client: Client,
  source: string,
  days: number,
  now: Date = new Date()
): Promise<CitationBucket[]> {
  const { startIso, endIso } = windowBounds(lastNDays(days, now));
  const res = await client.execute({
    sql: `SELECT citation_count AS count, COUNT(*) AS frequency
          FROM events
          WHERE source = ? AND ts >= ? AND ts <= ? AND citation_count IS NOT NULL
          GROUP BY citation_count
          ORDER BY citation_count`,
    args: [source, startIso, endIso],
  });
  return res.rows.map((r) => ({ count: Number(r.count), frequency: Number(r.frequency) }));
}

export async function topRetrievedIds(
  client: Client,
  source: string,
  days: number,
  limit: number,
  now: Date = new Date()
): Promise<RetrievedIdRow[]> {
  const { startIso, endIso } = windowBounds(lastNDays(days, now));
  const res = await client.execute({
    sql: `SELECT retrieved_ids FROM events
          WHERE source = ? AND ts >= ? AND ts <= ? AND retrieved_ids IS NOT NULL`,
    args: [source, startIso, endIso],
  });
  const counts = new Map<number, number>();
  for (const row of res.rows) {
    let ids: unknown;
    try {
      ids = JSON.parse(String(row.retrieved_ids));
    } catch {
      continue;
    }
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id !== 'number' || !Number.isFinite(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([chunkId, count]) => ({ chunkId, count }));
}
