import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from '../db/migrate';
import { insertEvent } from '../ingest/write';
import type { AskEvent, IngestEvent } from '../ingest/schema';
import { handleRollup, percentile, rollupDay, yesterdayUtc } from './rollup';

const CRON_SECRET = 'test-cron-secret';

function event(overrides: Partial<AskEvent> & { ts: string; totalMs: number }): IngestEvent {
  return {
    source: 'ask-zeroindex',
    event: 'ask' as const,
    model: 'claude-sonnet-4-6',
    question: `q-${overrides.ts}-${overrides.totalMs}`,
    outcome: 'ok',
    retrievedIds: [],
    citationCount: 1,
    retrievalMs: 100,
    firstTokenMs: 500,
    errorMessage: null,
    ...overrides,
  };
}

async function seed(client: Client, events: IngestEvent[]): Promise<void> {
  for (const e of events) {
    await insertEvent(client, e, JSON.stringify(e));
  }
}

describe('percentile', () => {
  it('returns null on empty input', () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it('returns the only value when one element', () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('matches the ceil-rank definition', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 0.5)).toBe(50);
    expect(percentile(v, 0.95)).toBe(100);
    expect(percentile(v, 0.99)).toBe(100);
  });

  it('handles unsorted input', () => {
    // sorted = [10, 30, 50, 100]; ceil(0.5 * 4) - 1 = 1 → 30
    expect(percentile([100, 10, 50, 30], 0.5)).toBe(30);
  });
});

describe('yesterdayUtc', () => {
  it('returns the UTC date one day before now', () => {
    expect(yesterdayUtc(new Date('2026-05-15T00:30:00.000Z'))).toBe('2026-05-14');
    expect(yesterdayUtc(new Date('2026-05-15T23:30:00.000Z'))).toBe('2026-05-14');
    expect(yesterdayUtc(new Date('2026-05-01T00:00:00.000Z'))).toBe('2026-04-30');
  });
});

describe('rollupDay', () => {
  let client: Client;

  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('returns an empty array when no events exist for the day', async () => {
    const result = await rollupDay(client, '2026-05-14');
    expect(result).toEqual([]);
  });

  it('aggregates events on a single day into one rollup row', async () => {
    await seed(client, [
      event({ ts: '2026-05-14T01:00:00.000Z', totalMs: 1000 }),
      event({ ts: '2026-05-14T05:00:00.000Z', totalMs: 2000 }),
      event({ ts: '2026-05-14T20:00:00.000Z', totalMs: 3000, outcome: 'stream_failed' }),
    ]);

    const result = await rollupDay(client, '2026-05-14');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: 'ask-zeroindex',
      day: '2026-05-14',
      events: 3,
      ok: 2,
      stream_failed: 1,
      retrieval_failed: 0,
      aborted: 0,
    });

    const stored = await client.execute("SELECT * FROM rollup_daily WHERE day = '2026-05-14'");
    expect(stored.rows).toHaveLength(1);
    expect(Number(stored.rows[0]?.events)).toBe(3);
  });

  it('aggregates the universal status axis and spend', async () => {
    await seed(client, [
      event({
        ts: '2026-05-14T01:00:00.000Z',
        totalMs: 1000,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
      event({ ts: '2026-05-14T02:00:00.000Z', totalMs: 2000, outcome: 'stream_failed' }),
      event({ ts: '2026-05-14T03:00:00.000Z', totalMs: 1500, outcome: 'aborted' }),
    ]);

    const [s] = await rollupDay(client, '2026-05-14');
    expect(s).toMatchObject({ n_ok: 1, n_error: 1, n_aborted: 1 });
    // Only the first event carries tokens: 1M in @ $3 + 1M out @ $15 = $18.
    expect(s?.sum_cost_usd).toBe(18);
    expect(s?.sum_input_tokens).toBe(1_000_000);
    expect(s?.sum_output_tokens).toBe(1_000_000);
  });

  it('leaves spend null for a day with no token data', async () => {
    await seed(client, [event({ ts: '2026-05-14T01:00:00.000Z', totalMs: 1000 })]);
    const [s] = await rollupDay(client, '2026-05-14');
    expect(s?.sum_cost_usd).toBeNull();
    expect(s?.sum_input_tokens).toBeNull();
  });

  it('excludes events outside the day window', async () => {
    await seed(client, [
      event({ ts: '2026-05-13T23:59:59.000Z', totalMs: 9999 }),
      event({ ts: '2026-05-14T00:00:00.000Z', totalMs: 1000 }),
      event({ ts: '2026-05-14T23:59:59.999Z', totalMs: 2000 }),
      event({ ts: '2026-05-15T00:00:00.000Z', totalMs: 9999 }),
    ]);

    const result = await rollupDay(client, '2026-05-14');
    expect(result[0]?.events).toBe(2);
  });

  it('partitions per source', async () => {
    process.env.SOURCE_TOKEN_OTHER_APP = 'irrelevant';
    await seed(client, [
      event({ ts: '2026-05-14T01:00:00.000Z', totalMs: 1000 }),
      event({ ts: '2026-05-14T02:00:00.000Z', totalMs: 2000, source: 'other-app' }),
    ]);

    const result = await rollupDay(client, '2026-05-14');
    expect(result).toHaveLength(2);
    const bySource = Object.fromEntries(result.map((r) => [r.source, r]));
    expect(bySource['ask-zeroindex']?.events).toBe(1);
    expect(bySource['other-app']?.events).toBe(1);
  });

  it('is idempotent — re-running overwrites the same row', async () => {
    await seed(client, [event({ ts: '2026-05-14T01:00:00.000Z', totalMs: 1000 })]);
    await rollupDay(client, '2026-05-14');
    await rollupDay(client, '2026-05-14');
    const rows = await client.execute('SELECT COUNT(*) AS n FROM rollup_daily');
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });

  it('computes latency percentiles correctly', async () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      event({ ts: `2026-05-14T0${i}:00:00.000Z`, totalMs: (i + 1) * 100 })
    );
    await seed(client, events);

    const [summary] = await rollupDay(client, '2026-05-14');
    expect(summary?.p50_total_ms).toBe(500);
    expect(summary?.p95_total_ms).toBe(1000);
    expect(summary?.p99_total_ms).toBe(1000);
  });
});

describe('handleRollup', () => {
  let client: Client;
  const originalCron = process.env.CRON_SECRET;

  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    if (originalCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCron;
  });

  function rollupRequest(opts: { auth?: string | null; day?: string } = {}) {
    const url = new URL('http://localhost/api/rollup');
    if (opts.day) url.searchParams.set('day', opts.day);
    const headers: Record<string, string> = {};
    if (opts.auth !== null && opts.auth !== undefined) headers.authorization = opts.auth;
    return new Request(url, { method: 'GET', headers });
  }

  it('401s without authorization header', async () => {
    const res = await handleRollup(client, rollupRequest({ auth: null }));
    expect(res.status).toBe(401);
  });

  it('401s with wrong secret', async () => {
    const res = await handleRollup(client, rollupRequest({ auth: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });

  it('400s on malformed day', async () => {
    const res = await handleRollup(
      client,
      rollupRequest({ auth: `Bearer ${CRON_SECRET}`, day: 'yesterday' })
    );
    expect(res.status).toBe(400);
  });

  it('200s and returns sources on success', async () => {
    await seed(client, [event({ ts: '2026-05-14T01:00:00.000Z', totalMs: 1000 })]);
    const res = await handleRollup(
      client,
      rollupRequest({ auth: `Bearer ${CRON_SECRET}`, day: '2026-05-14' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.day).toBe('2026-05-14');
    expect(body.sources).toHaveLength(1);
  });
});
