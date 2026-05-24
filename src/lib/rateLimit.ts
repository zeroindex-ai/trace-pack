// Turso-backed token bucket for /api/ingest. The endpoint is a public POST;
// without a throttle a single origin can flood it with requests that each cost
// a JSON parse + Zod validation + a timing-safe token compare before being
// rejected, and (when authenticated) an unbounded write into `events`.
//
// Keyed by client IP (x-forwarded-for) with a hashed UA + Accept-Language
// fallback for clients without a forwarded IP, so anonymous callers still
// share a per-fingerprint bucket rather than bypassing the limit entirely.
//
// Bucket: capacity 60 tokens, refill 60 tokens / 60s (1 token/sec sustained,
// 60-request burst). Generous enough for the legitimate server-to-server
// trace volume of a low-traffic site while throttling a single-origin flood.
// Distributed (botnet) floods are out of scope for v0.1 — those need an
// upstream edge/WAF limit, not an app-level bucket.
//
// State is persisted in `rate_limit_buckets` (see migrations/003_rate_limit.sql).
// The handler injects its libsql Client, matching the repo's DI convention so
// the limiter is testable against in-memory libsql.

import { createHash } from 'node:crypto';
import type { Client } from '@libsql/client';

export const BUCKET_CAPACITY = 60;
export const BUCKET_REFILL_PER_SEC = BUCKET_CAPACITY / 60;

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSec: number };

export type RateLimitOptions = {
  // Injected for tests; defaults to the module constants / wall clock.
  now?: () => number;
  capacity?: number;
  refillPerSec?: number;
};

// Pull the first non-empty IP from a possibly comma-separated x-forwarded-for.
// Assumes a trusted proxy (Vercel) sets/overwrites x-forwarded-for, so the
// leftmost value is the real client IP. A spoofed XFF could rotate the bucket
// key, but that's mitigated at the edge/WAF layer, not here (see PROJECT.md §2).
function firstForwardedIp(header: string | null): string | null {
  if (!header) return null;
  const first = header.split(',')[0]?.trim();
  return first ? first : null;
}

export function bucketKeyFromHeaders(headers: Headers): string {
  const ip = firstForwardedIp(headers.get('x-forwarded-for'));
  if (ip) return `ip:${ip}`;
  // Fall back to a stable hash of UA + Accept-Language so anonymous clients
  // without a forwarded IP still share a bucket per-fingerprint.
  const ua = headers.get('user-agent') ?? '';
  const lang = headers.get('accept-language') ?? '';
  const digest = createHash('sha256').update(`${ua}\n${lang}`).digest('hex').slice(0, 16);
  return `fp:${digest}`;
}

// Token-bucket math, isolated for unit testing without a DB.
export function computeNextState(
  currentTokens: number,
  lastUpdatedMs: number,
  nowMs: number,
  capacity: number,
  refillPerSec: number
): { tokens: number; allowed: boolean; retryAfterSec: number } {
  const elapsedSec = Math.max(0, (nowMs - lastUpdatedMs) / 1000);
  const refilled = Math.min(capacity, currentTokens + elapsedSec * refillPerSec);
  if (refilled >= 1) {
    return { tokens: refilled - 1, allowed: true, retryAfterSec: 0 };
  }
  const deficit = 1 - refilled;
  const retryAfterSec = refillPerSec > 0 ? Math.max(1, Math.ceil(deficit / refillPerSec)) : 3600;
  return { tokens: refilled, allowed: false, retryAfterSec };
}

export async function checkRateLimit(
  client: Pick<Client, 'execute'>,
  key: string,
  opts: RateLimitOptions = {}
): Promise<RateLimitDecision> {
  const now = opts.now ?? Date.now;
  const capacity = opts.capacity ?? BUCKET_CAPACITY;
  const refillPerSec = opts.refillPerSec ?? BUCKET_REFILL_PER_SEC;
  const nowMs = now();

  // Seed a full bucket the first time we see this key; ignored if it exists.
  await client.execute({
    sql: 'INSERT OR IGNORE INTO rate_limit_buckets (key, tokens, updated_at) VALUES (?, ?, ?)',
    args: [key, capacity, nowMs],
  });

  // Atomic refill-and-consume: one UPDATE recomputes the continuously refilled
  // balance and decrements a token only if that balance is >= 1. The refill and
  // the >= 1 guard live in SQL, so SQLite's single-writer lock serializes
  // concurrent requests on the same key — two can't both pass the guard. This
  // replaces a prior SELECT-then-write that had a TOCTOU race (interleaved
  // requests each read the same balance and were both allowed). RETURNING yields
  // the post-decrement balance for `remaining`.
  const refill = `MIN(?, tokens + ((? - updated_at) / 1000.0) * ?)`;
  const consumed = await client.execute({
    sql: `UPDATE rate_limit_buckets
             SET tokens = ${refill} - 1, updated_at = ?
           WHERE key = ? AND ${refill} >= 1
           RETURNING tokens`,
    args: [capacity, nowMs, refillPerSec, nowMs, key, capacity, nowMs, refillPerSec],
  });

  // A RETURNING row means the guarded UPDATE matched and consumed a token.
  // (libsql reports rowsAffected as 0 when RETURNING is present, so key off the
  // returned row, not rowsAffected.)
  const consumedRow = consumed.rows[0];
  if (consumedRow) {
    return { allowed: true, remaining: Math.floor(Number(consumedRow.tokens ?? 0)) };
  }

  // Denied — read current state only to compute a Retry-After. The guard above
  // already made the decision; this read doesn't affect correctness.
  const current = await client.execute({
    sql: 'SELECT tokens, updated_at FROM rate_limit_buckets WHERE key = ?',
    args: [key],
  });
  const row = current.rows[0];
  const tokens = row && row.tokens !== null ? Number(row.tokens) : 0;
  const lastUpdated = row && row.updated_at !== null ? Number(row.updated_at) : nowMs;
  const next = computeNextState(tokens, lastUpdated, nowMs, capacity, refillPerSec);
  return { allowed: false, retryAfterSec: next.retryAfterSec };
}
