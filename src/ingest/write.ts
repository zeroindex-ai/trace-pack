import { createHash } from 'node:crypto';
import type { Client } from '@libsql/client';
import { deriveOutcome, isAsk, type IngestEvent } from './schema';
import { costOf } from '../lib/pricing';

export type WriteResult = { written: boolean; dedupHash: string };

// What we hash for idempotency: for `ask`, the question (preserves existing row
// hashes); for other event types, an explicit idempotency key or the raw body.
function dedupInput(event: IngestEvent, rawJson: string): string {
  if (isAsk(event)) return event.question;
  return event.idempotencyKey ?? rawJson;
}

export async function insertEvent(client: Client, event: IngestEvent, rawJson: string): Promise<WriteResult> {
  const dedupHash = createHash('sha256').update(dedupInput(event, rawJson)).digest('hex');
  const { status, outcome, outcomeReason } = deriveOutcome(event);
  const cost = costOf(event.model, {
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheCreationInputTokens: event.cacheCreationInputTokens,
    cacheReadInputTokens: event.cacheReadInputTokens,
  });
  const ask = isAsk(event) ? event : null;

  const result = await client.execute({
    sql: `INSERT OR IGNORE INTO events (
      source, event, ts, model, question, dedup_hash, outcome, status, outcome_reason,
      retrieved_ids, citation_count, retrieval_ms, first_token_ms, total_ms,
      input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
      cost_usd, error_message, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      event.source,
      event.event,
      event.ts,
      event.model ?? null,
      ask ? ask.question : null,
      dedupHash,
      outcome,
      status,
      outcomeReason,
      ask ? JSON.stringify(ask.retrievedIds) : null,
      ask ? ask.citationCount : null,
      ask ? ask.retrievalMs : null,
      ask ? ask.firstTokenMs : null,
      event.totalMs ?? null,
      event.inputTokens ?? null,
      event.outputTokens ?? null,
      event.cacheCreationInputTokens ?? null,
      event.cacheReadInputTokens ?? null,
      cost,
      event.errorMessage ?? null,
      rawJson,
    ],
  });

  return { written: Number(result.rowsAffected) === 1, dedupHash };
}
