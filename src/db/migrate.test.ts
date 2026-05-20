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
    expect(applied).toEqual(['001_init.sql', '002_rollup.sql', '003_rate_limit.sql']);
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

  it('is idempotent — re-running does not error', async () => {
    const client = freshClient();
    await migrate(client);
    await expect(migrate(client)).resolves.toEqual(['001_init.sql', '002_rollup.sql', '003_rate_limit.sql']);
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
});
