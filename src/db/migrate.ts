import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, 'migrations');

// Records which migration files have run, in `schema_migrations`, so each
// applies exactly once. This matters from 004 onward: ALTER TABLE has no
// IF NOT EXISTS, so ADD COLUMN / RENAME COLUMN would error on a second pass.
// 001–003 are guarded with IF NOT EXISTS, so on the first run under this
// tracking runner they re-execute harmlessly, then get recorded.
//
// Returns the files applied on THIS call (empty once everything is up to date).
export async function migrate(client: Client): Promise<string[]> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`
  );
  const doneRes = await client.execute('SELECT name FROM schema_migrations');
  const done = new Set(doneRes.rows.map((r) => String(r.name)));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await client.executeMultiple(sql);
    await client.execute({
      sql: 'INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)',
      args: [file, new Date().toISOString()],
    });
    applied.push(file);
  }
  return applied;
}
