import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, 'migrations');

// Split a migration script into individual statements for client.batch().
// Strips `--` comments and splits on `;`. Migration files must therefore keep
// `;` only as a statement terminator — no triggers or string literals
// containing a semicolon. True for our DDL; revisit if that changes.
function splitSql(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Records which migration files have run, in `schema_migrations`, so each
// applies exactly once. This matters from 004 onward: ALTER TABLE has no
// IF NOT EXISTS, so ADD COLUMN / RENAME COLUMN would error on a second pass.
// 001–003 are guarded with IF NOT EXISTS, so on the first run under this
// tracking runner they re-execute harmlessly, then get recorded.
//
// Returns the files applied on THIS call (empty once everything is up to date).
export async function migrate(client: Client, migrationsDir: string = MIGRATIONS_DIR): Promise<string[]> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`
  );
  const doneRes = await client.execute('SELECT name FROM schema_migrations');
  const done = new Set(doneRes.rows.map((r) => String(r.name)));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // Apply the migration's statements AND its schema_migrations record as one
    // atomic batch. libsql wraps a batch in a transaction and rolls the whole
    // group back if any statement fails, so a mid-file failure can't leave a
    // half-applied ALTER that wedges the next run — and a recorded migration is
    // guaranteed to have fully applied. (batch runs on the client connection,
    // unlike client.transaction(), which opens a separate one — a problem for
    // a shared :memory: db.)
    await client.batch(
      [
        ...splitSql(sql),
        {
          sql: 'INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)',
          args: [file, new Date().toISOString()],
        },
      ],
      'write'
    );
    applied.push(file);
  }
  return applied;
}
