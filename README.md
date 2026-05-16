# trace-pack

A minimal LLM observability dashboard for Claude-based apps. Hosted at [trace.zeroindex.ai](https://trace.zeroindex.ai) *(planned)*.

Companion to [`@zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack):

- `eval-pack` = pre-prod correctness (file-producing library, run in CI)
- `trace-pack` = post-prod behavior (hosted service, ingests live events)

## Status

v0.1 in planning. See [`PROJECT.md`](./PROJECT.md) for the full scope, architecture, ingestion contract, and ordered work list.

## How it works

A consumer app POSTs a structured event per request to `/api/ingest`. `trace-pack` stores the event, aggregates it into a daily rollup, and renders aggregate views (public) and per-event detail (auth-gated admin).

The ingestion contract is documented in [`PROJECT.md` §4](./PROJECT.md#4-public-api-contracts).

## Local development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm dev
```

## License

MIT
