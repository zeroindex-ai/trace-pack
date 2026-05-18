import { createClient } from '@libsql/client';
import { migrate } from '../src/db/migrate';
import { insertEvent } from '../src/ingest/write';
import { rollupDay } from '../src/queries/rollup';
import type { IngestEvent } from '../src/ingest/schema';
import { utcDayOffset } from '../src/lib/dates';

async function main() {
  const url = process.env.TURSO_DATABASE_URL ?? 'file:./local.db';
  const client = createClient({ url });

  await migrate(client);

  const outcomes = [
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'retrieval_failed',
    'stream_failed',
    'aborted',
  ] as const;
  const now = new Date();
  const events: IngestEvent[] = [];

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const day = utcDayOffset(dayOffset, now);
    const eventsForDay = 3 + Math.floor(Math.random() * 10);
    for (let i = 0; i < eventsForDay; i++) {
      const hh = String(Math.floor(Math.random() * 24)).padStart(2, '0');
      const mm = String(Math.floor(Math.random() * 60)).padStart(2, '0');
      const ss = String(Math.floor(Math.random() * 60)).padStart(2, '0');
      events.push({
        source: 'ask-zeroindex',
        event: 'ask',
        ts: `${day}T${hh}:${mm}:${ss}.000Z`,
        model: 'claude-sonnet-4-6',
        question: `Sample question ${day}-${i}`,
        outcome: outcomes[Math.floor(Math.random() * outcomes.length)]!,
        retrievedIds: Array.from(
          { length: 3 + Math.floor(Math.random() * 3) },
          () => Math.floor(Math.random() * 20) + 1
        ),
        citationCount: Math.floor(Math.random() * 5),
        retrievalMs: 80 + Math.floor(Math.random() * 200),
        firstTokenMs: 300 + Math.floor(Math.random() * 1000),
        totalMs: 800 + Math.floor(Math.random() * 3000),
        errorMessage: null,
      });
    }
  }

  for (const e of events) {
    await insertEvent(client, e, JSON.stringify(e));
  }

  for (let dayOffset = 1; dayOffset < 14; dayOffset++) {
    await rollupDay(client, utcDayOffset(dayOffset, now));
  }

  console.log(`Seeded ${events.length} events into ${url}`);
}

void main();
