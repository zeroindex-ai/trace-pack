# trace-pack

A minimal LLM observability dashboard for Claude-based apps. Live at **[trace.zeroindex.ai](https://trace.zeroindex.ai)**.

Companion to [`@zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack):

- `eval-pack` = pre-prod correctness (file-producing library, run in CI) — reports at [evals.zeroindex.ai](https://evals.zeroindex.ai)
- `trace-pack` = post-prod behavior (hosted service, ingests live events) — dashboard at [trace.zeroindex.ai](https://trace.zeroindex.ai)

## Status

v0.1 shipped. The dashboard serves live traffic from [`ask-zeroindex`](https://github.com/zeroindex-ai/ask-zeroindex) via the optional dual-write in its `logAsk` path. See [`PROJECT.md`](./PROJECT.md) for the full scope, architecture, public API contracts, and decision log.

## How it works

A consumer app POSTs a structured event per request to `POST /api/ingest` with a per-source bearer token. `trace-pack` stores the event, aggregates it into a daily rollup (cron at 00:15 UTC), and renders:

- **`/`** — public aggregate dashboard (5 charts: traffic, outcomes, latency p50/p95/p99, citation distribution, top retrieved chunks)
- **`/admin`** — auth-gated detail (events table with pagination + filter, error feed, question clusters)
- **`/admin/[id]`** — single-event drill-down with prev/next neighbors

The ingestion contract is documented in [`PROJECT.md` §4](./PROJECT.md#4-public-api-contracts).

## Local development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test                                         # vitest, in-memory libsql
pnpm dev                                          # localhost:3000

# seed a local file:db with fake traffic
TURSO_DATABASE_URL=file:./local.db pnpm tsx scripts/seed-local.ts
```

## License

MIT
