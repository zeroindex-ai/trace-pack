/**
 * Backfill historical events into trace-pack.
 *
 * Reads line-delimited `vercel logs --json` output from stdin or --file=,
 * filters event=ask lines, and POSTs each to TRACE_PACK_URL/api/ingest.
 * Idempotent: trace-pack's INSERT OR IGNORE de-duplicates re-runs.
 *
 * Usage:
 *   vercel logs ask-zeroindex --json --since 30d | pnpm tsx scripts/backfill.ts
 *   pnpm tsx scripts/backfill.ts --file=logs.json
 *
 * Env (required):
 *   TRACE_PACK_URL    e.g. http://localhost:3000 or https://trace.zeroindex.ai
 *   TRACE_PACK_TOKEN  must match SOURCE_TOKEN_ASK_ZEROINDEX on the trace-pack side
 *
 * Env (optional):
 *   TRACE_PACK_SOURCE      default: ask-zeroindex
 *   BACKFILL_CONCURRENCY   default: 4
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  extractAskTrace,
  toIngestEvent,
  type IngestEventBody,
} from '../src/lib/backfill-parse';

type Stats = { lines: number; skipped: number; posted: number; errors: number };

async function postEvent(url: string, token: string, event: IngestEventBody): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(event),
  });
  if (res.status !== 204) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${body || res.statusText}`);
  }
}

function getFlag(name: string): string | null {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg === name) return '';
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return null;
}

async function main() {
  const baseUrl = process.env.TRACE_PACK_URL;
  const token = process.env.TRACE_PACK_TOKEN;
  if (!baseUrl || !token) {
    console.error('TRACE_PACK_URL and TRACE_PACK_TOKEN must be set.');
    process.exit(2);
  }
  const ingestUrl = `${baseUrl.replace(/\/$/, '')}/api/ingest`;
  const defaultSource = process.env.TRACE_PACK_SOURCE ?? 'ask-zeroindex';
  const concurrency = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY ?? 4));

  const filePath = getFlag('--file');
  const input = filePath ? createReadStream(filePath, 'utf8') : process.stdin;
  const rl = createInterface({ input, crlfDelay: Infinity });

  const stats: Stats = { lines: 0, skipped: 0, posted: 0, errors: 0 };
  const inFlight = new Set<Promise<unknown>>();

  console.log(
    `→ Backfilling to ${ingestUrl} (source=${defaultSource}, concurrency=${concurrency})`
  );
  if (filePath) console.log(`  reading from ${filePath}`);
  else console.log('  reading from stdin');

  for await (const line of rl) {
    stats.lines++;
    const trace = extractAskTrace(line);
    if (!trace) {
      stats.skipped++;
      continue;
    }
    const event = toIngestEvent(trace, defaultSource);
    if (!event) {
      stats.skipped++;
      continue;
    }

    const task = postEvent(ingestUrl, token, event)
      .then(() => {
        stats.posted++;
      })
      .catch((err) => {
        stats.errors++;
        console.warn(
          `  POST failed for ts=${event.ts}: ${err instanceof Error ? err.message : String(err)}`
        );
      });

    inFlight.add(task);
    task.finally(() => inFlight.delete(task));

    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }

    if (stats.lines % 100 === 0) {
      console.log(
        `  ${stats.lines} lines · ${stats.posted} posted · ${stats.skipped} skipped · ${stats.errors} errors`
      );
    }
  }

  await Promise.all(inFlight);

  console.log(
    `Done. ${stats.lines} lines · ${stats.posted} posted · ${stats.skipped} skipped · ${stats.errors} errors`
  );
  process.exit(stats.errors > 0 ? 1 : 0);
}

void main();
