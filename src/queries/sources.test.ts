import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from '../db/migrate';
import { insertEvent } from '../ingest/write';
import type { AskEvent, IngestEvent } from '../ingest/schema';
import { rollupDay } from './rollup';
import { compareSources, listSources, sourceOverview } from './sources';

const NOW = new Date('2026-05-15T12:00:00.000Z');

function event(overrides: Partial<AskEvent> & { ts: string }): IngestEvent {
  return {
    source: 'ask-zeroindex',
    event: 'ask' as const,
    model: 'claude-sonnet-4-6',
    question: `q-${overrides.ts}-${overrides.source ?? 'ask-zeroindex'}`,
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

describe('listSources', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('returns the known sources in canonical (evals) order, not alphabetical', async () => {
    // Seed alphabetically-out-of-order; intake-zero would precede repo-xray if
    // we sorted alphabetically, but canonical order puts repo-xray first.
    await seed(client, [
      event({ ts: '2026-05-14T01:00:00.000Z', source: 'intake-zero' }),
      event({ ts: '2026-05-14T02:00:00.000Z', source: 'repo-xray' }),
      event({ ts: '2026-05-14T03:00:00.000Z', source: 'ask-zeroindex' }),
      event({ ts: '2026-05-14T04:00:00.000Z', source: 'contract-lens' }),
    ]);
    const sources = await listSources(client);
    expect(sources).toEqual(['ask-zeroindex', 'contract-lens', 'repo-xray', 'intake-zero']);
    // The whole point of this change: repo-xray sorts BEFORE intake-zero.
    expect(sources.indexOf('repo-xray')).toBeLessThan(sources.indexOf('intake-zero'));
  });

  it('sorts an unknown source after the known four (alphabetically among unknowns)', async () => {
    await seed(client, [
      event({ ts: '2026-05-14T01:00:00.000Z', source: 'zzz-other' }),
      event({ ts: '2026-05-14T02:00:00.000Z', source: 'aaa-other' }),
      event({ ts: '2026-05-14T03:00:00.000Z', source: 'intake-zero' }),
      event({ ts: '2026-05-14T04:00:00.000Z', source: 'ask-zeroindex' }),
    ]);
    expect(await listSources(client)).toEqual([
      'ask-zeroindex',
      'intake-zero',
      'aaa-other',
      'zzz-other',
    ]);
  });

  it('returns empty when there are no events', async () => {
    expect(await listSources(client)).toEqual([]);
  });
});

describe('compareSources', () => {
  it('orders known sources by canonical (evals) position', () => {
    expect([...['intake-zero', 'repo-xray', 'ask-zeroindex', 'contract-lens']].sort(compareSources)).toEqual([
      'ask-zeroindex',
      'contract-lens',
      'repo-xray',
      'intake-zero',
    ]);
  });

  it('places any unknown source after all known ones', () => {
    expect(compareSources('intake-zero', 'zzz-other')).toBeLessThan(0);
    expect(compareSources('zzz-other', 'ask-zeroindex')).toBeGreaterThan(0);
  });
});

describe('sourceOverview', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('combines rollup (past) + live (today) per source', async () => {
    await seed(client, [
      // source A — past day (rolled up): one ok w/ cost, one error.
      event({ ts: '2026-05-14T01:00:00.000Z', inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      event({ ts: '2026-05-14T02:00:00.000Z', outcome: 'stream_failed' }),
      // source A — today (live).
      event({ ts: '2026-05-15T09:00:00.000Z' }),
      // source B — today only.
      event({ ts: '2026-05-15T10:00:00.000Z', source: 'other-app' }),
    ]);
    await rollupDay(client, '2026-05-14'); // populate the past-day rollup

    const overview = await sourceOverview(client, 30, NOW);
    const bySource = Object.fromEntries(overview.map((s) => [s.source, s]));

    // A: 2 past + 1 today = 3 events; 1 error → 1/3; cost $18 from the past ok event.
    expect(bySource['ask-zeroindex']?.events).toBe(3);
    expect(bySource['ask-zeroindex']?.errorRate).toBeCloseTo(1 / 3, 5);
    expect(bySource['ask-zeroindex']?.costUsd).toBe(18);
    expect(bySource['ask-zeroindex']?.lastSeen).toBe('2026-05-15T09:00:00.000Z');

    // B: 1 event today, no error, no token data → cost null.
    expect(bySource['other-app']?.events).toBe(1);
    expect(bySource['other-app']?.errorRate).toBe(0);
    expect(bySource['other-app']?.costUsd).toBeNull();
  });

  it('returns rows in canonical (evals) order regardless of event count', async () => {
    // intake-zero is the busiest, but canonical order still puts it last among
    // the known sources — ordering is by SOURCE_ORDER, not traffic.
    await seed(client, [
      event({ ts: '2026-05-15T01:00:00.000Z', source: 'intake-zero' }),
      event({ ts: '2026-05-15T02:00:00.000Z', source: 'intake-zero' }),
      event({ ts: '2026-05-15T03:00:00.000Z', source: 'intake-zero' }),
      event({ ts: '2026-05-15T04:00:00.000Z', source: 'repo-xray' }),
      event({ ts: '2026-05-15T05:00:00.000Z', source: 'ask-zeroindex' }),
      event({ ts: '2026-05-15T06:00:00.000Z', source: 'contract-lens' }),
      event({ ts: '2026-05-15T07:00:00.000Z', source: 'zzz-other' }),
    ]);
    const overview = await sourceOverview(client, 30, NOW);
    expect(overview.map((s) => s.source)).toEqual([
      'ask-zeroindex',
      'contract-lens',
      'repo-xray',
      'intake-zero',
      'zzz-other',
    ]);
  });
});
