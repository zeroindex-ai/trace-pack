/**
 * One-shot migration runner against a non-local Turso database.
 *
 * Usage:
 *   vercel env pull .env.local
 *   pnpm tsx --env-file=.env.local scripts/migrate-prod.ts
 *
 * Or via 1Password (no file on disk):
 *   op run --env-file=./.env.op -- pnpm tsx scripts/migrate-prod.ts
 *
 * Required env:
 *   TURSO_DATABASE_URL
 *   TURSO_AUTH_TOKEN  (omit for local file: URLs)
 *
 * Idempotent — every DDL uses IF NOT EXISTS, so re-running is safe.
 */

import { createClient } from '@libsql/client';
import { migrate } from '../src/db/migrate';

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error('TURSO_DATABASE_URL is required');
    process.exit(1);
  }
  const authToken = process.env.TURSO_AUTH_TOKEN;

  // Mask the entire hostname so the target appears in logs without exposing
  // it (the hostname is paired with a token in 1Password). Matches everything
  // between `libsql://` and the first path slash, or end-of-string.
  const masked = url.replace(/libsql:\/\/[^/]+/, 'libsql://***');
  console.log(`→ Migrating ${masked}`);

  const client = createClient({ url, authToken });
  const applied = await migrate(client);
  console.log(`Applied: ${applied.join(', ')}`);

  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  console.log(`Tables: ${tables.rows.map((r) => r.name).join(', ')}`);
}

void main();
