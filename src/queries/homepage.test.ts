import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from '../db/migrate';
import { insertEvent } from '../ingest/write';
import type { IngestEvent } from '../ingest/schema';
import { rollupDay } from './rollup';
import {
  citationHistogram,
  dailyLatencies,
  dailyOutcomes,
  dailyTraffic,
  lastNDays,
  topRetrievedIds,
} from './homepage';

const NOW = new Date('2026-05-15T12:00:00.000Z');

function event(ts: string, overrides: Partial<IngestEvent> = {}): IngestEvent {
  return {
    source: 'ask-zeroindex',
    event: 'ask',
    ts,
    model: 'claude-sonnet-4-6',
    question: `q-${ts}-${JSON.stringify(overrides)}`,
    outcome: 'ok',
    retrievedIds: [],
    citationCount: 1,
    retrievalMs: 100,
    firstTokenMs: 500,
    totalMs: 1000,
    errorMessage: null,
    ...overrides,
  };
}

async function seed(client: Client, events: IngestEvent[]): Promise<void> {
  for (const e of events) await insertEvent(client, e, JSON.stringify(e));
}

describe('lastNDays', () => {
  it('returns days ending today, length === days', () => {
    const window = lastNDays(7, NOW);
    expect(window).toHaveLength(7);
    expect(window[6]).toBe('2026-05-15');
    expect(window[0]).toBe('2026-05-09');
  });
});

describe('dailyTraffic', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('returns zero-filled window when no data exists', async () => {
    const result = await dailyTraffic(client, 'ask-zeroindex', 7, NOW);
    expect(result).toHaveLength(7);
    expect(result.every((r) => r.events === 0)).toBe(true);
  });

  it('reads past days from rollup_daily and today live from events', async () => {
    await seed(client, [
      event('2026-05-13T10:00:00.000Z'),
      event('2026-05-13T11:00:00.000Z'),
      event('2026-05-15T01:00:00.000Z'),
      event('2026-05-15T02:00:00.000Z'),
      event('2026-05-15T03:00:00.000Z'),
    ]);
    await rollupDay(client, '2026-05-13');

    const result = await dailyTraffic(client, 'ask-zeroindex', 7, NOW);
    const byDay = Object.fromEntries(result.map((r) => [r.day, r.events]));
    expect(byDay['2026-05-13']).toBe(2);
    expect(byDay['2026-05-14']).toBe(0);
    expect(byDay['2026-05-15']).toBe(3);
  });
});

describe('dailyOutcomes', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('partitions counts by outcome for past (rollup) and today (live)', async () => {
    await seed(client, [
      event('2026-05-13T10:00:00.000Z', { outcome: 'ok' }),
      event('2026-05-13T11:00:00.000Z', { outcome: 'stream_failed' }),
      event('2026-05-15T01:00:00.000Z', { outcome: 'ok' }),
      event('2026-05-15T02:00:00.000Z', { outcome: 'aborted' }),
    ]);
    await rollupDay(client, '2026-05-13');

    const result = await dailyOutcomes(client, 'ask-zeroindex', 7, NOW);
    const byDay = Object.fromEntries(result.map((r) => [r.day, r]));
    expect(byDay['2026-05-13']).toMatchObject({ ok: 1, stream_failed: 1 });
    expect(byDay['2026-05-15']).toMatchObject({ ok: 1, aborted: 1 });
  });
});

describe('dailyLatencies', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('returns null fields for empty days', async () => {
    const result = await dailyLatencies(client, 'ask-zeroindex', 3, NOW);
    expect(result.every((r) => r.p50_total_ms === null)).toBe(true);
  });

  it('reads percentiles from rollup for past, computes live for today', async () => {
    await seed(client, [
      event('2026-05-13T10:00:00.000Z', { totalMs: 100 }),
      event('2026-05-13T11:00:00.000Z', { totalMs: 200 }),
      event('2026-05-13T12:00:00.000Z', { totalMs: 300 }),
      event('2026-05-15T01:00:00.000Z', { totalMs: 1000 }),
      event('2026-05-15T02:00:00.000Z', { totalMs: 2000 }),
    ]);
    await rollupDay(client, '2026-05-13');

    const result = await dailyLatencies(client, 'ask-zeroindex', 3, NOW);
    const byDay = Object.fromEntries(result.map((r) => [r.day, r]));
    expect(byDay['2026-05-13']?.p50_total_ms).toBe(200);
    expect(byDay['2026-05-15']?.p50_total_ms).toBe(1000);
    expect(byDay['2026-05-15']?.p95_total_ms).toBe(2000);
  });
});

describe('citationHistogram', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('groups counts by citation_count within the window', async () => {
    await seed(client, [
      event('2026-05-14T01:00:00.000Z', { citationCount: 0 }),
      event('2026-05-14T02:00:00.000Z', { citationCount: 2 }),
      event('2026-05-14T03:00:00.000Z', { citationCount: 2 }),
      event('2026-05-15T04:00:00.000Z', { citationCount: 3 }),
    ]);
    const result = await citationHistogram(client, 'ask-zeroindex', 7, NOW);
    expect(result).toEqual([
      { count: 0, frequency: 1 },
      { count: 2, frequency: 2 },
      { count: 3, frequency: 1 },
    ]);
  });
});

describe('topRetrievedIds', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('flattens retrieved_ids JSON arrays and ranks by occurrence', async () => {
    await seed(client, [
      event('2026-05-14T01:00:00.000Z', { retrievedIds: [3, 4, 5] }),
      event('2026-05-14T02:00:00.000Z', { retrievedIds: [3, 5, 7] }),
      event('2026-05-15T03:00:00.000Z', { retrievedIds: [5] }),
    ]);
    const result = await topRetrievedIds(client, 'ask-zeroindex', 7, 5, NOW);
    expect(result[0]).toEqual({ chunkId: 5, count: 3 });
    expect(result[1]).toEqual({ chunkId: 3, count: 2 });
  });

  it('respects the limit', async () => {
    await seed(client, [event('2026-05-14T01:00:00.000Z', { retrievedIds: [1, 2, 3, 4, 5] })]);
    const result = await topRetrievedIds(client, 'ask-zeroindex', 7, 2, NOW);
    expect(result).toHaveLength(2);
  });
});
