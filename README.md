# trace-pack

A minimal LLM observability dashboard for Claude-based apps. Live at **[traces.zeroindex.ai](https://traces.zeroindex.ai)**.

Companion to [`@zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack):

- `eval-pack` = pre-prod correctness (file-producing library, run in CI) — reports at [evals.zeroindex.ai](https://evals.zeroindex.ai)
- `trace-pack` = post-prod behavior (hosted service, ingests live events) — dashboard at [traces.zeroindex.ai](https://traces.zeroindex.ai)

## Status

v0.2 shipped. v0.2 generalized the original `ask`-shaped model into a universal multi-app event core (a `ok`/`error`/`aborted` status axis, token counts, and a derived per-request `cost_usd`) with a source-aware UI, so trace-pack now observes any Claude app — not just RAG Q&A. It serves live traffic from multiple consumers (`ask-zeroindex`, `contract-lens`, intake-zero) via the optional dual-write in their telemetry paths. See [`PROJECT.md`](./PROJECT.md) for scope, architecture, and API contracts, and [`docs/v0.2-multi-app-design.md`](./docs/v0.2-multi-app-design.md) for the v0.2 model.

## How it works

A consumer app POSTs a structured event per request to `POST /api/ingest` with a per-source bearer token — either an `ask` event (the RAG Q&A shape) or a `GenericEvent` (any other app, carrying the universal status + token core). `trace-pack` derives cost at ingest, stores the event, aggregates it into a daily rollup (cron at 00:15 UTC), and renders:

- **`/`** — public, source-aware aggregate dashboard (traffic, status/outcomes, latency p50/p95/p99, spend/cost, plus the `ask`-specific citation distribution + top retrieved chunks for RAG sources)
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
