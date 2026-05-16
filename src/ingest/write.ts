import { createHash } from 'node:crypto';
import type { Client } from '@libsql/client';
import type { IngestEvent } from './schema';

export type WriteResult = { written: boolean; questionHash: string };

export async function insertEvent(
  client: Client,
  event: IngestEvent,
  rawJson: string
): Promise<WriteResult> {
  const questionHash = createHash('sha256').update(event.question).digest('hex');
  const result = await client.execute({
    sql: `INSERT OR IGNORE INTO events (
      source, event, ts, model, question, question_hash, outcome,
      retrieved_ids, citation_count, retrieval_ms, first_token_ms,
      total_ms, error_message, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      event.source,
      event.event,
      event.ts,
      event.model,
      event.question,
      questionHash,
      event.outcome,
      JSON.stringify(event.retrievedIds),
      event.citationCount,
      event.retrievalMs,
      event.firstTokenMs,
      event.totalMs,
      event.errorMessage ?? null,
      rawJson,
    ],
  });
  return { written: Number(result.rowsAffected) === 1, questionHash };
}
