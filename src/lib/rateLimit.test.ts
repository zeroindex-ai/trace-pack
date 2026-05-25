import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from '../db/migrate';
import { bucketKeyFromHeaders, checkRateLimit, computeNextState } from './rateLimit';

describe('computeNextState', () => {
  it('allows and decrements when a full token is available', () => {
    const next = computeNextState(5, 0, 0, 60, 1);
    expect(next.allowed).toBe(true);
    expect(next.tokens).toBe(4);
    expect(next.retryAfterSec).toBe(0);
  });

  it('denies and reports retry-after when below one token', () => {
    const next = computeNextState(0, 0, 0, 60, 1);
    expect(next.allowed).toBe(false);
    expect(next.tokens).toBe(0);
    expect(next.retryAfterSec).toBe(1);
  });

  it('refills over elapsed time but never above capacity', () => {
    // 30s at 1 token/sec from empty → 30 tokens, capped well under capacity.
    const next = computeNextState(0, 0, 30_000, 60, 1);
    expect(next.allowed).toBe(true);
    expect(next.tokens).toBe(29);

    // Long idle never exceeds capacity.
    const capped = computeNextState(60, 0, 10_000_000, 60, 1);
    expect(capped.tokens).toBe(59);
  });

  it('returns a finite retry-after even when refill is zero', () => {
    const next = computeNextState(0, 0, 0, 1, 0);
    expect(next.allowed).toBe(false);
    expect(Number.isFinite(next.retryAfterSec)).toBe(true);
  });
});

describe('bucketKeyFromHeaders', () => {
  it('prefers the first forwarded IP', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    expect(bucketKeyFromHeaders(h)).toBe('ip:203.0.113.7');
  });

  it('falls back to a stable UA+lang fingerprint when no IP is present', () => {
    const h = new Headers({ 'user-agent': 'curl/8', 'accept-language': 'en' });
    const key = bucketKeyFromHeaders(h);
    expect(key).toMatch(/^fp:[0-9a-f]{16}$/);
    // Stable across calls with the same headers.
    expect(bucketKeyFromHeaders(new Headers({ 'user-agent': 'curl/8', 'accept-language': 'en' }))).toBe(key);
  });
});

describe('checkRateLimit (in-memory libsql)', () => {
  let client: Client;
  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
  });

  it('allows up to capacity then denies, with a fixed clock', async () => {
    const now = () => 1_000_000;
    const opts = { now, capacity: 3, refillPerSec: 1 };
    const r1 = await checkRateLimit(client, 'ip:test', opts);
    const r2 = await checkRateLimit(client, 'ip:test', opts);
    const r3 = await checkRateLimit(client, 'ip:test', opts);
    const r4 = await checkRateLimit(client, 'ip:test', opts);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false);
    if (!r4.allowed) expect(r4.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('keeps separate buckets per key', async () => {
    const opts = { now: () => 1_000_000, capacity: 1, refillPerSec: 1 };
    const a1 = await checkRateLimit(client, 'ip:a', opts);
    const b1 = await checkRateLimit(client, 'ip:b', opts);
    expect(a1.allowed).toBe(true);
    expect(b1.allowed).toBe(true);
  });

  it('never over-allows past capacity under a concurrent same-key burst', async () => {
    // Fire N requests at one key in a single Promise.all so they are dispatched
    // concurrently from JS, sharing one in-memory bucket, and assert the total
    // admitted never exceeds capacity. The pre-fix SELECT-then-write let
    // interleaved requests each read the full bucket and all pass; the guarded
    // atomic UPDATE admits at most `capacity`.
    //
    // HONESTY NOTE: libsql's :memory: client serializes statements on a single
    // connection, so although the calls are launched in parallel they execute
    // one-at-a-time. This therefore proves the single-statement SQL guard
    // (refill + `>= 1` check + decrement in one UPDATE) is correct and admits
    // no more than capacity — it does NOT exercise true OS-level write
    // concurrency. That last mile is what SQLite's single-writer lock covers in
    // production (see rateLimit.ts), which can't be reliably reproduced here.
    for (const capacity of [1, 5]) {
      await client.execute('DELETE FROM rate_limit_buckets');
      const opts = { now: () => 1_000_000, capacity, refillPerSec: 1 };
      const results = await Promise.all(
        Array.from({ length: 16 }, () => checkRateLimit(client, 'ip:burst', opts))
      );
      const allowed = results.filter((r) => r.allowed).length;
      expect(allowed).toBe(capacity);
      expect(allowed).toBeLessThanOrEqual(capacity);
    }
  });
});
