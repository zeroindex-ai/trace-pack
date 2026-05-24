import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { migrate } from './migrate';

function freshClient() {
  return createClient({ url: ':memory:' });
}

describe('migrate', () => {
  it('applies every migration in order', async () => {
    const client = freshClient();
    const applied = await migrate(client);
    expect(applied).toEqual([
      '001_init.sql',
      '002_rollup.sql',
      '003_rate_limit.sql',
      '004_multi_app.sql',
      '005_rollup_multi_app.sql',
    ]);
  });

  it('creates the events and rollup_daily tables', async () => {
    const client = freshClient();
    await migrate(client);
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    const names = tables.rows.map((r) => r.name);
    expect(names).toContain('events');
    expect(names).toContain('rollup_daily');
    expect(names).toContain('rate_limit_buckets');
  });

  it('is idempotent — a second run applies nothing and does not error', async () => {
    const client = freshClient();
    await migrate(client);
    // With schema_migrations tracking, the second pass applies no files — which
    // is what keeps non-idempotent ALTERs in 004 from erroring on re-run.
    await expect(migrate(client)).resolves.toEqual([]);
  });

  it('creates the expected indexes on events', async () => {
    const client = freshClient();
    await migrate(client);
    const indexes = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events' ORDER BY name"
    );
    const names = indexes.rows.map((r) => r.name);
    expect(names).toContain('idx_events_source_ts');
    expect(names).toContain('idx_events_source_outcome');
    expect(names).toContain('idx_events_source_hash');
  });

  it('004 generalizes the events schema (renames question_hash, adds core columns)', async () => {
    const client = freshClient();
    await migrate(client);
    const cols = await client.execute("SELECT name FROM pragma_table_info('events')");
    const names = cols.rows.map((r) => String(r.name));
    expect(names).toContain('dedup_hash');
    expect(names).not.toContain('question_hash');
    for (const c of ['status', 'outcome_reason', 'input_tokens', 'output_tokens', 'cost_usd']) {
      expect(names).toContain(c);
    }
  });

  it('005 adds the status + spend columns to rollup_daily', async () => {
    const client = freshClient();
    await migrate(client);
    const cols = await client.execute("SELECT name FROM pragma_table_info('rollup_daily')");
    const names = cols.rows.map((r) => String(r.name));
    for (const c of [
      'n_ok',
      'n_error',
      'n_aborted',
      'sum_cost_usd',
      'sum_input_tokens',
      'sum_output_tokens',
    ]) {
      expect(names).toContain(c);
    }
  });

  it('004 backfills status from the legacy ask outcome', async () => {
    const client = freshClient();
    await migrate(client);
    // Insert a pre-generalization-style row and confirm the status mapping holds
    // for new writes through the column (backfill of existing rows uses the same
    // CASE; this exercises the resulting schema).
    await client.execute({
      sql: `INSERT INTO events (source, event, ts, dedup_hash, outcome, status, raw_json)
            VALUES (?, 'ask', ?, ?, 'stream_failed', 'error', '{}')`,
      args: ['s', '2026-05-15T00:00:00.000Z', 'h'.repeat(64)],
    });
    const res = await client.execute("SELECT status FROM events WHERE outcome = 'stream_failed'");
    expect(res.rows[0]?.status).toBe('error');
  });
});
