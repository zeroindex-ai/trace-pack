import type { Client } from '@libsql/client';
import { dayBounds, lastNDays } from '@/lib/dates';

// Canonical app order, mirroring evals.zeroindex.ai's landing-page order
// (evals-site/public/index.html). The two repos can't share a file, so keep
// this in sync if the evals lineup changes.
export const SOURCE_ORDER = ['ask-zeroindex', 'contract-lens', 'repo-xray', 'intake-zero'] as const;

// Sort by position in SOURCE_ORDER; any source not in the list sorts after the
// known ones, alphabetically among themselves (a new/unexpected source still
// appears deterministically — just at the end — rather than being dropped).
export function compareSources(a: string, b: string): number {
  const ia = SOURCE_ORDER.indexOf(a as (typeof SOURCE_ORDER)[number]);
  const ib = SOURCE_ORDER.indexOf(b as (typeof SOURCE_ORDER)[number]);
  const ra = ia === -1 ? SOURCE_ORDER.length : ia;
  const rb = ib === -1 ? SOURCE_ORDER.length : ib;
  return ra - rb || a.localeCompare(b);
}

// Distinct event sources, for the source switcher, in canonical app order.
export async function listSources(client: Client): Promise<string[]> {
  const res = await client.execute('SELECT DISTINCT source FROM events');
  return res.rows.map((r) => String(r.source)).sort(compareSources);
}

export type SourceSummary = {
  source: string;
  events: number;
  errorRate: number; // 0..1 (status = error / events); 0 when no events
  costUsd: number | null; // null when no event in the window carried cost
  lastSeen: string | null;
};

// Per-source at-a-glance over the last N days: events, error rate, spend, last-seen.
// Past days come from rollup_daily (status counts + cost sums); the in-flight day is
// read live from events. Latency is intentionally omitted — a window p95 isn't a
// rollup-exact metric, so it lives on the per-source dashboard, not the overview.
export async function sourceOverview(
  client: Client,
  days: number,
  now: Date = new Date()
): Promise<SourceSummary[]> {
  const window = lastNDays(days, now);
  const first = window[0];
  const today = window[window.length - 1];
  if (first === undefined || today === undefined) {
    throw new Error('day window must contain at least one day');
  }
  const { startIso: todayStart, nextDayStartIso: todayNextStart } = dayBounds(today);

  type Acc = { events: number; errors: number; cost: number | null };
  const acc = new Map<string, Acc>();
  const bump = (source: string, events: number, errors: number, cost: number | null) => {
    const a = acc.get(source) ?? { events: 0, errors: 0, cost: null };
    a.events += events;
    a.errors += errors;
    if (cost != null) a.cost = (a.cost ?? 0) + cost;
    acc.set(source, a);
  };

  // Past days from the rollup.
  const past = await client.execute({
    sql: `SELECT source, SUM(events) AS events, SUM(n_error) AS errors, SUM(sum_cost_usd) AS cost
          FROM rollup_daily WHERE day >= ? AND day < ? GROUP BY source`,
    args: [first, today],
  });
  for (const r of past.rows) {
    bump(
      String(r.source),
      Number(r.events ?? 0),
      Number(r.errors ?? 0),
      r.cost == null ? null : Number(r.cost)
    );
  }

  // In-flight day, live from events.
  const live = await client.execute({
    sql: `SELECT source,
                 COUNT(*) AS events,
                 SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
                 SUM(cost_usd) AS cost
          FROM events WHERE ts >= ? AND ts < ? GROUP BY source`,
    args: [todayStart, todayNextStart],
  });
  for (const r of live.rows) {
    bump(
      String(r.source),
      Number(r.events ?? 0),
      Number(r.errors ?? 0),
      r.cost == null ? null : Number(r.cost)
    );
  }

  // Last-seen per source (cheap via idx_events_source_ts). Also surfaces sources
  // that exist but had no events in the window.
  const seen = await client.execute('SELECT source, MAX(ts) AS last_seen FROM events GROUP BY source');
  const lastSeen = new Map<string, string>();
  for (const r of seen.rows) lastSeen.set(String(r.source), String(r.last_seen));
  for (const s of lastSeen.keys()) if (!acc.has(s)) acc.set(s, { events: 0, errors: 0, cost: null });

  return [...acc.entries()]
    .map(([source, a]) => ({
      source,
      events: a.events,
      errorRate: a.events === 0 ? 0 : a.errors / a.events,
      costUsd: a.cost,
      lastSeen: lastSeen.get(source) ?? null,
    }))
    .sort((x, y) => compareSources(x.source, y.source));
}
