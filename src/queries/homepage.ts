import type { Client, Row } from '@libsql/client';
import { dayBounds, lastNDays, windowBounds } from '@/lib/dates';
import { STATUSES, type Status } from '@/ingest/schema';
import { percentile } from './rollup';

export { lastNDays } from '@/lib/dates';

export type DailyTraffic = { day: string; events: number };
// Universal status axis (ok/error/aborted) so the chart works for any event
// type. The granular ask outcome (retrieval_failed vs stream_failed) still
// lives on /admin (the outcome column + error feed).
export type DailyOutcomes = {
  day: string;
  ok: number;
  error: number;
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
export type DailySpend = {
  day: string;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
};

function emptyStatuses(): Record<Status, number> {
  return { ok: 0, error: 0, aborted: 0 };
}

// CEILING NOTE — live "today" aggregation is unbounded.
//
// Historical days are served from the precomputed `rollup_daily` table, but the
// current day is recomputed live on every `force-dynamic` homepage request: the
// `dailyTraffic` / `dailyOutcomes` / `dailyLatencies` paths each run a COUNT or
// a full-row percentile scan over *all* of today's raw `events` for the source.
// There is intentionally no LIMIT or volume cap on these scans.
//
// This is safe under the v0.1 traffic assumption (a single-digit-thousands/day
// ceiling per source on a small libsql DB), where a day's events comfortably fit
// in a sub-100ms scan. It does NOT scale: at high daily volume these scans grow
// linearly with traffic and will eventually dominate homepage latency. The fix
// when that day comes is an incremental/partial rollup of the in-progress day
// (e.g. an hourly rollup the live path tops up from) rather than a raw LIMIT —
// a LIMIT here would silently under-count today's totals and percentiles.

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

// Shared skeleton for the four daily-series readers: build the N-day window,
// read historical days from the precomputed `rollup_daily` table, recompute the
// in-progress current day live from raw `events`, then emit one entry per day in
// the window (filling gaps with `emptyFor`). Each caller supplies only the bits
// that differ — the two queries, how to map a rollup/today row into the series
// shape, and the per-day default. Keeps the rollup/live-today merge logic in one
// place instead of repeating it per metric.
async function mergeDailySeries<T extends { day: string }>(
  client: Client,
  source: string,
  days: number,
  now: Date,
  spec: {
    rollupSql: string;
    fromRollupRow: (r: Row) => T;
    todayFromEvents: (client: Client, startIso: string, nextDayStartIso: string, today: string) => Promise<T>;
    emptyFor: (day: string) => T;
  }
): Promise<T[]> {
  const window = lastNDays(days, now);
  const { first, today } = windowEdges(window);

  const rollup = await client.execute({ sql: spec.rollupSql, args: [source, first, today] });
  const byDay = new Map<string, T>();
  for (const r of rollup.rows) {
    const mapped = spec.fromRollupRow(r);
    byDay.set(mapped.day, mapped);
  }

  const { startIso, nextDayStartIso } = dayBounds(today);
  byDay.set(today, await spec.todayFromEvents(client, startIso, nextDayStartIso, today));

  return window.map((d) => byDay.get(d) ?? spec.emptyFor(d));
}

export async function dailyTraffic(
  client: Client,
  source: string,
  days: number,
  now: Date = new Date()
): Promise<DailyTraffic[]> {
  return mergeDailySeries<DailyTraffic>(client, source, days, now, {
    rollupSql: 'SELECT day, events FROM rollup_daily WHERE source = ? AND day >= ? AND day < ?',
    fromRollupRow: (r) => ({ day: String(r.day), events: Number(r.events) }),
    todayFromEvents: async (c, startIso, nextDayStartIso, today) => {
      const todayRow = await c.execute({
        sql: 'SELECT COUNT(*) AS n FROM events WHERE source = ? AND ts >= ? AND ts < ?',
        args: [source, startIso, nextDayStartIso],
      });
      return { day: today, events: Number(todayRow.rows[0]?.n ?? 0) };
    },
    emptyFor: (d) => ({ day: d, events: 0 }),
  });
}

export async function dailyOutcomes(
  client: Client,
  source: string,
  days: number,
  now: Date = new Date()
): Promise<DailyOutcomes[]> {
  return mergeDailySeries<DailyOutcomes>(client, source, days, now, {
    rollupSql: `SELECT day, n_ok, n_error, n_aborted
          FROM rollup_daily WHERE source = ? AND day >= ? AND day < ?`,
    fromRollupRow: (r) => ({
      day: String(r.day),
      ok: Number(r.n_ok ?? 0),
      error: Number(r.n_error ?? 0),
      aborted: Number(r.n_aborted ?? 0),
    }),
    todayFromEvents: async (c, startIso, nextDayStartIso, today) => {
      const todayRows = await c.execute({
        sql: `SELECT status, COUNT(*) AS n FROM events
          WHERE source = ? AND ts >= ? AND ts < ? GROUP BY status`,
        args: [source, startIso, nextDayStartIso],
      });
      const todayCounts = emptyStatuses();
      for (const r of todayRows.rows) {
        const s = r.status == null ? '' : String(r.status);
        if ((STATUSES as readonly string[]).includes(s)) {
          todayCounts[s as Status] = Number(r.n);
        }
      }
      return { day: today, ...todayCounts };
    },
    emptyFor: (d) => ({ day: d, ...emptyStatuses() }),
  });
}

export async function dailyLatencies(
  client: Client,
  source: string,
  days: number,
  now: Date = new Date()
): Promise<DailyLatency[]> {
  const emptyFor = (d: string): DailyLatency => ({
    day: d,
    p50_total_ms: null,
    p95_total_ms: null,
    p99_total_ms: null,
    p50_first_token_ms: null,
    p95_first_token_ms: null,
    p99_first_token_ms: null,
  });
  return mergeDailySeries<DailyLatency>(client, source, days, now, {
    rollupSql: `SELECT day, p50_total_ms, p95_total_ms, p99_total_ms,
                 p50_first_token_ms, p95_first_token_ms, p99_first_token_ms
          FROM rollup_daily WHERE source = ? AND day >= ? AND day < ?`,
    fromRollupRow: (r) => {
      const num = (key: string) => (r[key] == null ? null : Number(r[key]));
      return {
        day: String(r.day),
        p50_total_ms: num('p50_total_ms'),
        p95_total_ms: num('p95_total_ms'),
        p99_total_ms: num('p99_total_ms'),
        p50_first_token_ms: num('p50_first_token_ms'),
        p95_first_token_ms: num('p95_first_token_ms'),
        p99_first_token_ms: num('p99_first_token_ms'),
      };
    },
    todayFromEvents: async (c, startIso, nextDayStartIso, today) => {
      const todayRows = await c.execute({
        sql: 'SELECT total_ms, first_token_ms FROM events WHERE source = ? AND ts >= ? AND ts < ?',
        args: [source, startIso, nextDayStartIso],
      });
      const totals: number[] = [];
      const firstTokens: number[] = [];
      for (const r of todayRows.rows) {
        if (r.total_ms != null) totals.push(Number(r.total_ms));
        if (r.first_token_ms != null) firstTokens.push(Number(r.first_token_ms));
      }
      return {
        day: today,
        p50_total_ms: percentile(totals, 0.5),
        p95_total_ms: percentile(totals, 0.95),
        p99_total_ms: percentile(totals, 0.99),
        p50_first_token_ms: percentile(firstTokens, 0.5),
        p95_first_token_ms: percentile(firstTokens, 0.95),
        p99_first_token_ms: percentile(firstTokens, 0.99),
      };
    },
    emptyFor,
  });
}

export async function dailySpend(
  client: Client,
  source: string,
  days: number,
  now: Date = new Date()
): Promise<DailySpend[]> {
  return mergeDailySeries<DailySpend>(client, source, days, now, {
    rollupSql: `SELECT day, sum_cost_usd, sum_input_tokens, sum_output_tokens
          FROM rollup_daily WHERE source = ? AND day >= ? AND day < ?`,
    fromRollupRow: (r) => ({
      day: String(r.day),
      cost_usd: r.sum_cost_usd == null ? null : Number(r.sum_cost_usd),
      input_tokens: r.sum_input_tokens == null ? null : Number(r.sum_input_tokens),
      output_tokens: r.sum_output_tokens == null ? null : Number(r.sum_output_tokens),
    }),
    todayFromEvents: async (c, startIso, nextDayStartIso, today) => {
      const todayRow = await c.execute({
        sql: `SELECT SUM(cost_usd) AS cost, SUM(input_tokens) AS inp, SUM(output_tokens) AS outp
          FROM events WHERE source = ? AND ts >= ? AND ts < ?`,
        args: [source, startIso, nextDayStartIso],
      });
      const tr = todayRow.rows[0];
      return {
        day: today,
        cost_usd: tr?.cost == null ? null : Number(tr.cost),
        input_tokens: tr?.inp == null ? null : Number(tr.inp),
        output_tokens: tr?.outp == null ? null : Number(tr.outp),
      };
    },
    emptyFor: (d) => ({ day: d, cost_usd: null, input_tokens: null, output_tokens: null }),
  });
}

export async function citationHistogram(
  client: Client,
  source: string,
  days: number,
  now: Date = new Date()
): Promise<CitationBucket[]> {
  const { startIso, nextDayStartIso } = windowBounds(lastNDays(days, now));
  const res = await client.execute({
    sql: `SELECT citation_count AS count, COUNT(*) AS frequency
          FROM events
          WHERE source = ? AND ts >= ? AND ts < ? AND citation_count IS NOT NULL
          GROUP BY citation_count
          ORDER BY citation_count`,
    args: [source, startIso, nextDayStartIso],
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
  const { startIso, nextDayStartIso } = windowBounds(lastNDays(days, now));
  const res = await client.execute({
    sql: `SELECT retrieved_ids FROM events
          WHERE source = ? AND ts >= ? AND ts < ? AND retrieved_ids IS NOT NULL`,
    args: [source, startIso, nextDayStartIso],
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
