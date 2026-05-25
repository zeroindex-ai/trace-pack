import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from '../db/migrate';
import { insertEvent } from '../ingest/write';
import type { AskEvent, IngestEvent } from '../ingest/schema';
import { errorEvents, eventById, neighbors, questionClusters, recentEvents } from './admin';

const NOW = new Date('2026-05-15T12:00:00.000Z');

function event(ts: string, overrides: Partial<AskEvent> = {}): IngestEvent {
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

describe('recentEvents', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('paginates newest-first', async () => {
    await seed(client, [
      event('2026-05-14T01:00:00.000Z'),
      event('2026-05-14T02:00:00.000Z'),
      event('2026-05-14T03:00:00.000Z'),
      event('2026-05-14T04:00:00.000Z'),
      event('2026-05-14T05:00:00.000Z'),
    ]);
    const page1 = await recentEvents(client, 'ask-zeroindex', { limit: 2, offset: 0 });
    expect(page1.total).toBe(5);
    expect(page1.rows).toHaveLength(2);
    expect(page1.rows[0]?.ts).toBe('2026-05-14T05:00:00.000Z');
    expect(page1.rows[1]?.ts).toBe('2026-05-14T04:00:00.000Z');

    const page2 = await recentEvents(client, 'ask-zeroindex', { limit: 2, offset: 2 });
    expect(page2.rows[0]?.ts).toBe('2026-05-14T03:00:00.000Z');
  });

  it('filters by outcome', async () => {
    await seed(client, [
      event('2026-05-14T01:00:00.000Z', { outcome: 'ok' }),
      event('2026-05-14T02:00:00.000Z', { outcome: 'stream_failed' }),
      event('2026-05-14T03:00:00.000Z', { outcome: 'ok' }),
    ]);
    const result = await recentEvents(client, 'ask-zeroindex', {
      limit: 10,
      offset: 0,
      outcome: 'stream_failed',
    });
    expect(result.total).toBe(1);
    expect(result.rows[0]?.outcome).toBe('stream_failed');
  });

  it("ignores outcome='all'", async () => {
    await seed(client, [
      event('2026-05-14T01:00:00.000Z', { outcome: 'ok' }),
      event('2026-05-14T02:00:00.000Z', { outcome: 'aborted' }),
    ]);
    const result = await recentEvents(client, 'ask-zeroindex', {
      limit: 10,
      offset: 0,
      outcome: 'all',
    });
    expect(result.total).toBe(2);
  });
});

describe('errorEvents', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it("returns only outcome != 'ok'", async () => {
    await seed(client, [
      event('2026-05-14T01:00:00.000Z', { outcome: 'ok' }),
      event('2026-05-14T02:00:00.000Z', { outcome: 'stream_failed', errorMessage: 'boom' }),
      event('2026-05-14T03:00:00.000Z', { outcome: 'retrieval_failed' }),
    ]);
    const rows = await errorEvents(client, 'ask-zeroindex', 10);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.outcome !== 'ok')).toBe(true);
  });

  it('respects the limit', async () => {
    await seed(client, [
      event('2026-05-14T01:00:00.000Z', { outcome: 'aborted' }),
      event('2026-05-14T02:00:00.000Z', { outcome: 'aborted' }),
      event('2026-05-14T03:00:00.000Z', { outcome: 'aborted' }),
    ]);
    const rows = await errorEvents(client, 'ask-zeroindex', 2);
    expect(rows).toHaveLength(2);
  });
});

describe('questionClusters', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('groups by dedup_hash and ranks by count', async () => {
    await seed(client, [
      event('2026-05-14T01:00:00.000Z', { question: 'common q' }),
      event('2026-05-14T02:00:00.000Z', { question: 'common q' }),
      event('2026-05-14T03:00:00.000Z', { question: 'common q' }),
      event('2026-05-14T04:00:00.000Z', { question: 'rare q' }),
    ]);
    const rows = await questionClusters(client, 'ask-zeroindex', 30, 10, NOW);
    expect(rows[0]?.count).toBe(3);
    expect(rows[0]?.sample_question).toBe('common q');
    expect(rows[1]?.count).toBe(1);
  });

  it('respects the time window', async () => {
    await seed(client, [event('2026-03-01T00:00:00.000Z'), event('2026-05-14T00:00:00.000Z')]);
    const rows = await questionClusters(client, 'ask-zeroindex', 7, 10, NOW);
    expect(rows).toHaveLength(1);
  });
});

describe('eventById', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('returns null for unknown id', async () => {
    expect(await eventById(client, 999)).toBeNull();
  });

  it('returns full detail row including raw_json and dedup_hash', async () => {
    await seed(client, [event('2026-05-14T01:00:00.000Z')]);
    const detail = await eventById(client, 1);
    expect(detail).not.toBeNull();
    expect(detail?.dedup_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(detail?.raw_json).toContain('ask-zeroindex');
  });
});

describe('neighbors', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('returns prev and next for a middle event', async () => {
    await seed(client, [
      event('2026-05-14T01:00:00.000Z'),
      event('2026-05-14T02:00:00.000Z'),
      event('2026-05-14T03:00:00.000Z'),
    ]);
    const result = await neighbors(client, 'ask-zeroindex', '2026-05-14T02:00:00.000Z');
    expect(result.prev?.id).toBe(1);
    expect(result.next?.id).toBe(3);
  });

  it('returns null prev for the oldest event', async () => {
    await seed(client, [event('2026-05-14T01:00:00.000Z'), event('2026-05-14T02:00:00.000Z')]);
    const result = await neighbors(client, 'ask-zeroindex', '2026-05-14T01:00:00.000Z');
    expect(result.prev).toBeNull();
    expect(result.next?.id).toBe(2);
  });

  it('returns both null when no neighbors exist on either side', async () => {
    await seed(client, [event('2026-05-14T01:00:00.000Z')]);
    expect(await neighbors(client, 'ask-zeroindex', '2026-05-14T01:00:00.000Z')).toEqual({
      prev: null,
      next: null,
    });
  });
});
