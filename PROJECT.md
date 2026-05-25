# trace-pack — Project Documentation

> **Status: shipped v0.2** — public dashboard live at [traces.zeroindex.ai](https://traces.zeroindex.ai). v0.2 generalized the original `ask`-shaped model into a universal multi-app event core (status axis + tokens + cost) with a source-aware UI; it now observes multiple ZeroIndex Claude apps (`ask-zeroindex`, `contract-lens`, intake-zero) via their dual-write paths, not just the one RAG consumer. The v0.2 model is specified in [`docs/v0.2-multi-app-design.md`](./docs/v0.2-multi-app-design.md) (marked shipped); the sections below were written for v0.1 and are annotated where v0.2 changed them.

This document captures the scope, strategic decisions, architecture, public contracts, distribution shape, and ordered work list for `trace-pack`. It exists to:

1. Onboard future collaborators (or future-you, in a clean session)
2. Capture the **reasoning** behind decisions, not just the decisions themselves
3. Document engineering decisions and tradeoffs as a durable complement to the code

---

## 1. Project overview

### What `trace-pack` is

A minimal, opinionated LLM observability dashboard for small Claude-based applications. A consumer app POSTs a structured event per request; `trace-pack` stores, aggregates, and renders.

> **v0.2 (shipped 2026-05-23–25).** The model below started life as the single, `ask`-shaped RAG schema. v0.2 split it into a **universal core** every Claude app shares — a coarse `status` axis (`ok`/`error`/`aborted`), input/output/cache token counts, and a derived `cost_usd` — plus a per-event-type extension (`ask` is now just one event type; any other app sends a `GenericEvent`). The dashboard is now **source-aware** (multiple consumers, a source selector) and carries a **cost axis**. `docs/v0.2-multi-app-design.md` is the authoritative spec for the generalized schema, ingest contract, and UI; the v0.1-framed prose in §4–§6 below is kept for the reasoning and annotated where v0.2 superseded it.

The companion to [`eval-pack`](https://github.com/zeroindex-ai/eval-pack):

- `eval-pack` = **pre-prod correctness** (file-producing library, run in CI)
- `trace-pack` = **post-prod behavior** (hosted service, runs continuously)

Where `eval-pack` is a library you import, `trace-pack` is a hosted dashboard you point your app at. Where `eval-pack` produces a single HTML report per CI run, `trace-pack` ingests events continuously and renders aggregate views over time.

### Why this project

The eval methodology (`eval-pack`) tells you whether your LLM app gets answers right on a curated golden set. It says nothing about what real users actually ask, how latency behaves under real load, what fraction of requests fail in production, or which retrieved chunks dominate. Most teams glue this together from a logging vendor, a chart library, and three SQL queries — but the _interesting_ metrics for a small Claude app are different from those any generic APM gives you (first-token latency, citation count distribution, retrieved-id heatmap).

- **Lifted from a real consumer.** The first consumer is [`ask-zeroindex`](https://github.com/zeroindex-ai/ask-zeroindex), which already emits the exact event shape this project ingests (see `app/api/ask` `logAsk` in that repo). v0.1 work is generalization, storage, and presentation — not greenfield instrumentation.
- **Opinionated, not generic.** This is not an OTel collector. It's a dashboard with a defined event schema (a universal core + an `ask` extension, not arbitrary spans), a handful of pages, and a small set of metrics chosen to be useful for a Claude-app author specifically.
- **Multi-tenant ready, and now multi-tenant in the UI.** The data model carried a `source` tenant key from day one; v0.1 rendered a single source. As of v0.2 the UI is source-aware (multiple consumers + a source selector) — and, as designed, adding consumers needed no schema migration of the core key.

### Goals & success criteria for v0.1

| Goal                                           | Metric                                                                            | Status |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Public dashboard live                          | `traces.zeroindex.ai` serves real `ask-zeroindex` traffic                         | ✅     |
| Ingestion contract documented                  | `POST /api/ingest` accepts `ask-zeroindex`'s current event verbatim               | ✅     |
| Zero perceptible latency added to the consumer | `ask-zeroindex` `logAsk` continues to complete in <1ms p99 (fire-and-forget POST) | ✅     |
| Linked from the marketing site                 | `zeroindex.ai` Observability use-case card gains a "See live traces →" link       | ✅     |
| Owner-only admin view                          | `/admin` shows full traces, error feed, drill-down behind auth                    | ✅     |
| Daily rollup keeps homepage cheap              | Homepage SSR fetches one row per visible day, not raw events                      | ✅     |

### Out of scope (for v0.1)

- **Real-time / live-tail view.** Daily rollup + on-demand reload covers current traffic. Live-tail lands when a consumer's volume warrants it.
- ~~**Multi-tenant UI.**~~ **Shipped in v0.2** — the source selector arrived with the second consumer, as planned.
- ~~**Cost tracking** (`inputTokens`, `outputTokens`, $ per request).~~ **Shipped in v0.2** — the universal core now carries input/output/cache tokens and a derived `cost_usd` (`src/lib/pricing.ts`).
- **Alerting / paging.** Threshold breaches → notifications belong in v0.2 once we know which thresholds matter in practice.
- **Full OpenTelemetry tracing** (spans, parent IDs, distributed propagation). A flat event-per-request model is enough for the current consumer; OTel arrives only if a consumer's shape needs it.
- **Log-drain ingestion.** See §2 — direct POST is the chosen path for v0.1.
- **Question full-text search.** Turso FTS5 is available; defer until volume makes it useful.
- **Public per-event drill-down.** Aggregate views only on the public homepage; per-event detail is auth-gated.
- **Telemetry / phone-home / usage analytics.** Never.

---

## 2. Strategic decisions log

Load-bearing decisions, documented because the _why_ often outlasts the _what_.

### Stack picks

| Decision             | Choice                                                                                                             | Reasoning                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **App framework**    | Next.js 16 on Vercel Pro                                                                                           | Consistent with `ask-zeroindex`. App Router + Server Components let the dashboard SSR every chart server-side — no client-side data fetching, no SPA-router complexity for a four-page site.                                                           |
| **Storage**          | Turso libsql                                                                                                       | Consistent with `ask-zeroindex`. SQLite semantics with a managed hosted layer. The query shapes here (aggregate by day, percentile over a window, top-N by group) are exactly what SQLite is good at. A real time-series DB is overkill at this scale. |
| **Charts**           | Recharts                                                                                                           | Mature, declarative, SSR-friendly. D3 would be overkill for time-series + bars + histograms; the data shapes are simple.                                                                                                                               |
| **Validation**       | Zod                                                                                                                | Already in the stack via `ask-zeroindex` and `eval-pack`. Used at the ingest boundary and on the rollup contract.                                                                                                                                      |
| **Tests**            | Vitest                                                                                                             | Already in the stack.                                                                                                                                                                                                                                  |
| **Auth on `/admin`** | Basic auth via Next.js `proxy.ts` (renamed from `middleware.ts` in Next 16) with a single `ADMIN_PASSWORD` env var | Smallest viable surface for a single-owner dashboard. Swap to a real provider when multi-tenant arrives.                                                                                                                                               |
| **Package manager**  | pnpm 10                                                                                                            | Same as the rest of the stack.                                                                                                                                                                                                                         |
| **Node**             | CI/dev on Node 24; `package.json` `engines` floor is `>=20`                                                        | CI and local dev run Node 24, matching the rest of the stack. The `engines` floor stays at `>=20` so the package still installs on any current LTS.                                                                                                    |
| **License**          | MIT                                                                                                                | Matches `eval-pack` and `mcp-pack`.                                                                                                                                                                                                                    |

### Things deliberately NOT chosen

| Avoided                                           | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel Log Drains as the ingestion path**       | Log drains are real-time and require zero consumer change, but: (1) they deliver _all_ function logs and force `trace-pack` to parse a noisy unstructured stream filtering on `event=ask`; (2) they tie the contract to Vercel-hosted consumers; (3) they make multi-source coordination painful (one drain per source). Direct POST is a 5-line consumer change, keeps stdout intact for Vercel-side diagnostics, and gives `trace-pack` a contract it controls. |
| **ClickHouse / Tinybird / a real time-series DB** | At `ask-zeroindex`'s current traffic (single-digit requests per minute peak), SQLite is dramatically over-resourced. Turso scales sideways far longer than this project will need. The day a consumer's volume justifies ClickHouse is the day we're long past v0.1.                                                                                                                                                                                              |
| **Full OpenTelemetry**                            | OTel pays back when you have multiple services and need distributed propagation. A single Next.js app emitting one event per request gets nothing from spans/baggage. Adopt when an actual consumer has the shape.                                                                                                                                                                                                                                                |
| **A client-side SPA dashboard**                   | Server Components SSR the charts. No `useEffect`-to-fetch, no loading skeletons, no client/server data drift. A dashboard whose data updates on page load is fast enough.                                                                                                                                                                                                                                                                                         |
| **A "logs" view in addition to the events table** | The events table _is_ the logs view. Splitting them would be ceremony.                                                                                                                                                                                                                                                                                                                                                                                            |
| **Per-event public drill-down**                   | User-typed questions are the only field that _could_ leak something. Aggregates are safe to publish; raw events stay behind auth.                                                                                                                                                                                                                                                                                                                                 |
| **Server-side question redaction in v0.1**        | The current consumer (`ask-zeroindex`) answers Q&A about ZeroIndex itself — low PII risk. An optional `redactQuestion` hook is reserved in the schema; ships empty.                                                                                                                                                                                                                                                                                               |

### Architecture decisions

| Decision                     | Choice                                                                                                                                                                                   | Reasoning                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ingestion contract**       | `POST /api/ingest` with bearer token; one event per request                                                                                                                              | Consumer-friendly (5-line change), auth-friendly (per-source token), evolvable (additive schema).                                                                                                                                                                                                                   |
| **Schema evolution**         | Store full payload as `raw_json`; promote known fields to typed columns                                                                                                                  | New fields from consumers never get rejected. Typed columns can be added in subsequent migrations and back-filled from `raw_json`.                                                                                                                                                                                  |
| **Multi-tenancy**            | `source` column on every row, indexed with `ts`                                                                                                                                          | v0.1 ships with one source. Adding a second is a token + a UI selector — no schema change.                                                                                                                                                                                                                          |
| **Storage of question text** | Stored on the server, never rendered on the public homepage, rendered on the auth-gated admin view                                                                                       | The privacy-sensitive content stays behind auth; the public face is aggregates only.                                                                                                                                                                                                                                |
| **Aggregation strategy**     | Daily rollup table refreshed by Vercel Cron at 00:15 UTC + on-the-fly aggregation for "today"                                                                                            | Homepage SSR reads one row per visible day from `rollup_daily` + a single aggregation query for the in-flight day. Avoids percentile-over-30-days queries on every page load.                                                                                                                                       |
| **Percentile computation**   | JS percentile computation over rows pulled for the day window — simpler than SQLite's lack of native percentile UDF, fine at v0.1 traffic levels.                                        | Honest p50/p95/p99 without external tools. At Turso's scale, fine.                                                                                                                                                                                                                                                  |
| **Idempotency**              | `(source, ts, dedup_hash)` natural key with `INSERT OR IGNORE`                                                                                                                        | Duplicate replays from a consumer retry don't create double-count. Not strict idempotency — collisions are rare and benign.                                                                                                                                                                                         |
| **Backfill path**            | One-shot script reads `vercel logs --json`, filters `event=ask`, POSTs to `/api/ingest`                                                                                                  | The current consumer's history lives in Vercel logs. Backfill makes the dashboard non-empty on day one.                                                                                                                                                                                                             |
| **Rate limiting**            | Turso-backed token bucket on `/api/ingest`, checked before any parse/auth work. Per-IP key (UA+lang fingerprint fallback), capacity 60, refill 1 token/sec. Returns 429 + `Retry-After`. | A public POST must not let a single origin burn CPU on parse + Zod + token-compare or grow `events` unbounded. Generous enough for legitimate server-to-server trace volume; throttles single-origin floods. Distributed/botnet floods are out of scope for v0.1 — those want an edge/WAF limit, not an app bucket. |

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                Consumer app (e.g. ask-zeroindex)                     │
│                                                                       │
│   logAsk(trace)                                                       │
│     ├── console.log(...)         ← unchanged; preserves Vercel logs   │
│     └── POST traces.zeroindex.ai/api/ingest  (if TRACE_PACK_URL set)   │
│         Authorization: Bearer ${TRACE_PACK_TOKEN}                     │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    trace-pack (Next.js on Vercel Pro)                │
│                                                                       │
│   app/                                                                │
│   ├── api/ingest/route.ts        POST handler, Zod-validated         │
│   ├── api/rollup/route.ts        Cron-invoked daily aggregation      │
│   ├── page.tsx                   public aggregate dashboard          │
│   ├── admin/page.tsx             auth-gated events + errors          │
│   ├── admin/[id]/page.tsx        single-event drill-down              │
│   └── (proxy.ts at repo root)     basic auth on /admin/*              │
│                                                                       │
│   src/                                                                │
│   ├── db/                         Turso libsql client + migrations    │
│   ├── ingest/                     Zod schema + write logic            │
│   ├── queries/                    every SQL query the UI uses         │
│   ├── charts/                     Recharts wrappers                   │
│   └── types/                                                          │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          Turso libsql                                 │
│                                                                       │
│   events            append-only event store + raw_json passthrough    │
│   rollup_daily      one row per (source, day) for cheap homepage SSR  │
└──────────────────────────────────────────────────────────────────────┘
```

### Data flow per event

```
Consumer logAsk()
   │
   ├─→ POST /api/ingest  { source, event, ts, model, question, outcome,
   │                       retrievedIds, citationCount, retrievalMs,
   │                       firstTokenMs, totalMs, errorMessage? }
   │
   ├─→ Zod-validate envelope; reject 400 on bad shape
   ├─→ Verify bearer token against source's expected token
   ├─→ Compute dedup_hash = sha256(question)
   ├─→ INSERT OR IGNORE into events (PK includes dedup_hash + ts)
   └─→ 204 No Content
```

### Read path

- **Public `/`** — server component reads `rollup_daily` for last 30 days + one in-flight aggregation for "today" from `events`. Renders 5 charts.
- **Admin `/admin`** — server component paginates `events` filtered by `outcome != 'ok'` (default view) or all.
- **Admin `/admin/[id]`** — server component reads one event row, renders the full `raw_json` plus typed fields.

---

## 4. Public API contracts

### Ingestion: `POST /api/ingest`

Request:

```http
POST /api/ingest HTTP/1.1
Host: traces.zeroindex.ai
Content-Type: application/json
Authorization: Bearer <per-source-token>

{
  "source": "ask-zeroindex",
  "event": "ask",
  "ts": "2026-05-15T12:34:56.789Z",
  "model": "claude-sonnet-4-6",
  "question": "What services does ZeroIndex offer?",
  "outcome": "ok",
  "retrievedIds": [3, 4, 5, 10, 11],
  "citationCount": 3,
  "retrievalMs": 142,
  "firstTokenMs": 612,
  "totalMs": 2104,
  "errorMessage": null
}
```

The body above is an **`ask`-type event** — still valid verbatim, so `ask-zeroindex` needed no wire change. As of v0.2 it is one of two shapes the endpoint accepts.

Response: `204 No Content` on success, `400` on schema violation, `401` on bad/missing token, `502` on storage failure.

Zod schema (v0.2 — a union of `ask` and everything else; authoritative source is `src/ingest/schema.ts`):

```ts
// Universal core every event carries (the v0.2 cost axis lives here).
const coreFields = {
  source: z.string().min(1).max(64),
  ts: z.string().datetime(),
  model: z.string().min(1).nullable().optional(),
  inputTokens: z.number().int().min(0).nullable().optional(),
  outputTokens: z.number().int().min(0).nullable().optional(),
  cacheCreationInputTokens: z.number().int().min(0).nullable().optional(),
  cacheReadInputTokens: z.number().int().min(0).nullable().optional(),
  totalMs: z.number().int().min(0).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
};

// The RAG Q&A extension — unchanged on the wire from v0.1.
export const AskEvent = z.object({
  ...coreFields,
  event: z.literal('ask'),
  model: z.string().min(1),                 // tightened: ask always has these
  totalMs: z.number().int().min(0),
  outcome: z.enum(['ok', 'retrieval_failed', 'stream_failed', 'aborted']),
  question: z.string().min(1).max(2000),
  retrievedIds: z.array(z.number().int()).default([]),
  citationCount: z.number().int().min(0),
  retrievalMs: z.number().int().min(0),
  firstTokenMs: z.number().int().min(0).nullable(),
}).passthrough();

// Any other app: sends the universal `status` directly + an optional reason.
export const GenericEvent = z.object({
  ...coreFields,
  event: z.string().min(1).max(64).refine((e) => e !== 'ask'),
  status: z.enum(['ok', 'error', 'aborted']),
  outcomeReason: z.string().min(1).max(120).nullable().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).passthrough();

// Union (not discriminatedUnion): the non-ask discriminator is open (any string ≠ 'ask').
export const IngestEvent = z.union([AskEvent, GenericEvent]);
```

The `passthrough()` is load-bearing: it's the forward-compatibility guarantee. Consumers can add fields without coordinating with `trace-pack`; per-type fields ride along in `raw_json` and are promoted to columns only when a chart needs them. An `ask` event's `status` is derived from its `outcome` (`*_failed → error`); other events send `status` directly.

### Cron: `GET /api/rollup`

Vercel Cron–invoked once per day at 00:15 UTC (Vercel Cron issues `GET`). Aggregates yesterday's `events` into `rollup_daily`. Idempotent (`INSERT OR REPLACE`).

---

## 5. Storage schema

The authoritative DDL is `src/db/migrations/` (001–005; see §7). The block below is the **current (v0.2) shape** — the v0.1 `events` table plus the universal core that migration `004` added. v0.2 columns are marked.

```sql
CREATE TABLE events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,
  event           TEXT NOT NULL,           -- 'ask' or any other event type (v0.2)
  ts              TEXT NOT NULL,           -- ISO 8601 UTC
  model           TEXT,
  question        TEXT,                    -- ask-only; NULL for other event types
  dedup_hash      TEXT NOT NULL,           -- renamed from question_hash in 004
  outcome         TEXT,                    -- ask vocabulary; NULL for non-ask
  -- v0.2 universal core (migration 004):
  status          TEXT,                    -- coarse axis: ok / error / aborted
  outcome_reason  TEXT,                    -- app-specific reason (nullable)
  input_tokens               INTEGER,
  output_tokens              INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens     INTEGER,
  cost_usd        REAL,                    -- derived at ingest (src/lib/pricing.ts)
  -- ask extension fields:
  retrieved_ids   TEXT,                    -- JSON array, opaque
  citation_count  INTEGER,
  retrieval_ms    INTEGER,
  first_token_ms  INTEGER,
  total_ms        INTEGER,
  error_message   TEXT,
  raw_json        TEXT NOT NULL,           -- the full POSTed body verbatim
  UNIQUE (source, ts, dedup_hash)          -- idempotency on retries
);
CREATE INDEX idx_events_source_ts        ON events (source, ts DESC);
CREATE INDEX idx_events_source_outcome   ON events (source, outcome);
CREATE INDEX idx_events_source_hash      ON events (source, dedup_hash);

CREATE TABLE rollup_daily (
  source              TEXT NOT NULL,
  day                 TEXT NOT NULL,       -- YYYY-MM-DD UTC
  events              INTEGER NOT NULL,
  ok                  INTEGER NOT NULL,
  retrieval_failed    INTEGER NOT NULL,
  stream_failed       INTEGER NOT NULL,
  aborted             INTEGER NOT NULL,
  p50_total_ms        INTEGER,
  p95_total_ms        INTEGER,
  p99_total_ms        INTEGER,
  p50_first_token_ms  INTEGER,
  p95_first_token_ms  INTEGER,
  p99_first_token_ms  INTEGER,
  avg_citations       REAL,
  -- v0.2 universal status + spend rollup (migration 005):
  n_ok                INTEGER,
  n_error             INTEGER,
  n_aborted           INTEGER,
  sum_cost_usd        REAL,
  sum_input_tokens    INTEGER,
  sum_output_tokens   INTEGER,
  PRIMARY KEY (source, day)
);
```

> **v0.2 note.** The `ok`/`retrieval_failed`/`stream_failed`/`aborted` and `avg_citations`/`first_token` columns above are the `ask`-specific rollup; v0.2 added the universal `n_ok`/`n_error`/`n_aborted` status counts and the `sum_cost_usd`/`sum_*_tokens` spend dimension (migration 005) so the multi-app overview + spend views read precomputed numbers. Status counts backfilled from the ask outcomes; token/cost sums are NULL for pre-token days and fill forward.

### Why these indexes

- `(source, ts DESC)` — every dashboard query is "events for source X over the last N days, newest first." This is the workhorse.
- `(source, outcome)` — the error feed on `/admin` filters by outcome.
- `(source, dedup_hash)` — supports the "show me every time someone asked this question" cluster view on `/admin`.

### Why the `UNIQUE` constraint matters

If a consumer retries an ingest call (network blip, deploy restart), the `(source, ts, dedup_hash)` triple makes the second write a no-op via `INSERT OR IGNORE`. Not strict idempotency — two genuinely-different requests with the same question and (millisecond-identical) timestamp would collapse — but that collision is vanishingly rare and the failure mode (one row instead of two) is benign.

---

## 6. UI surfaces

> **v0.2 note.** The surfaces below describe the v0.1 single-source `ask` dashboard. v0.2 made the UI **source-aware** (a multi-app overview + per-source selector) and added a **status axis** (`ok`/`error`/`aborted`, generalizing the ask outcomes) and a **cost/spend** view driven by the new token + `cost_usd` columns. The `ask`-specific charts (citation histogram, top retrieved IDs, first-token latency) render for `ask` sources; non-`ask` sources show the universal status + cost + latency surfaces. See `docs/v0.2-multi-app-design.md` §4 for the full v0.2 UI spec.

### Public `/` — aggregate-only

1. **Traffic sparkline** — events per day for the last 30 days
2. **Outcome stacked bar** — ok / retrieval_failed / stream_failed / aborted, per day
3. **Latency percentiles** — p50/p95/p99 for `totalMs` and `firstTokenMs`, two line charts side by side
4. **Citation count histogram** — distribution across all `citationCount` values
5. **Top retrieved IDs** — bar chart of which `retrievedIds` show up most often (proxy for "which content is doing the work")

Question text is never rendered on this page.

### Admin `/admin` — auth-gated

6. **Events table** — paginated, default-sorted newest first. Columns: id, ts, outcome, total_ms, first_token_ms, citation_count, question (truncated). Filter: outcome.
7. **Error feed** — `outcome != 'ok'` only. Columns: ts, outcome, errorMessage, question. Click-through to the full event.
8. **Question clusters** — group by `dedup_hash`, show count + most recent ts + sample question text. The "what do users actually ask" view.

### Admin `/admin/[id]` — single event

9. **Full event detail** — every typed field, the full `raw_json`, links to neighboring events (prev/next by ts).

### Design constraints

- All charts SSR. No loading skeletons, no client-side fetches.
- Public page is one bundle, no auth check (it's hosted on Vercel's CDN).
- `/admin/*` middleware does basic auth. No session, no cookie management; the browser handles it.

---

## 7. Repository layout

```
trace-pack/
├── app/
│   ├── page.tsx                 public aggregate dashboard
│   ├── layout.tsx               root layout
│   ├── api/
│   │   ├── ingest/route.ts      POST ingestion endpoint
│   │   └── rollup/route.ts      Vercel Cron daily aggregator
│   └── admin/
│       ├── page.tsx             events + errors + clusters
│       └── [id]/page.tsx        single-event drill-down
├── proxy.ts                     basic-auth gate on /admin/* (Next 16 — was middleware.ts in 15)
├── src/
│   ├── db/
│   │   ├── client.ts            Turso libsql client + retry wrapper
│   │   ├── migrations/
│   │   │   ├── 001_init.sql
│   │   │   ├── 002_rollup.sql
│   │   │   ├── 003_rate_limit.sql
│   │   │   ├── 004_multi_app.sql      v0.2: universal core (status + tokens + cost), question_hash→dedup_hash
│   │   │   └── 005_rollup_multi_app.sql  v0.2: status + spend rollup columns
│   │   └── migrate.ts           runs every migration in order; tracked in schema_migrations
│   ├── ingest/
│   │   ├── schema.ts            Zod IngestEvent union (AskEvent | GenericEvent)
│   │   ├── handler.ts           parse → auth → cost → write orchestration
│   │   ├── auth.ts              bearer-token resolution from env
│   │   └── write.ts             insert-or-ignore wrapper
│   ├── queries/
│   │   ├── homepage.ts          one query per public chart
│   │   ├── admin.ts             events table, error feed, clusters
│   │   ├── sources.ts           v0.2: per-source list + multi-app overview
│   │   └── rollup.ts            the daily aggregation SQL
│   ├── charts/
│   │   ├── TrafficSparkline.tsx
│   │   ├── OutcomeStack.tsx
│   │   ├── LatencyLines.tsx
│   │   ├── CitationHistogram.tsx
│   │   └── TopRetrieved.tsx
│   └── lib/
│       ├── backfill-parse.ts    pure parse + map logic for the backfill script
│       ├── dates.ts             UTC day-offset helpers
│       ├── format.ts            canonical admin timestamp/number formatting
│       ├── palette.ts           chart color tokens mirroring globals.css :root
│       ├── pricing.ts           v0.2: per-model token→cost_usd table + derivation
│       ├── rateLimit.ts         Turso-backed token bucket for /api/ingest
│       └── timingSafeCompare.ts constant-time string equality
├── scripts/
│   └── backfill.ts              read vercel logs --json, POST to /api/ingest
├── package.json
├── tsconfig.json
├── next.config.ts
├── vercel.json                  Cron config for /api/rollup
├── .github/workflows/ci.yml     typecheck + lint + test on PRs
├── PROJECT.md                   this file
├── README.md                    user-facing intro
└── LICENSE                      MIT
```

---

## 8. Ordered work list

v0.1 work-list. Status markers reflect current state.

1. ✅ **Scaffold the repo.** Next.js 16, ESLint, Vitest, CI workflow, MIT `LICENSE`.
2. ✅ **Provision Turso database.** `trace-pack` libsql database created; creds stored in 1Password and Vercel.
3. ✅ **Implement migrations.** `001_init.sql` (events) + `002_rollup.sql` (rollup_daily). Idempotent runner at `src/db/migrate.ts`; one-off prod runner at `scripts/migrate-prod.ts`.
4. ✅ **Implement `/api/ingest`.** Zod schema with `passthrough()` for forward-compat, per-source bearer auth via `SOURCE_TOKEN_<NAME>` env-var convention, timing-safe compare, `INSERT OR IGNORE` for idempotency.
5. ✅ **Patch `ask-zeroindex` `logAsk`.** Extracted to `src/lib/logAsk.ts`; env-gated fire-and-forget POST with `keepalive: true`; errors swallowed, never throws to the route.
6. ✅ **Backfill script.** `scripts/backfill.ts` reads vercel logs JSON (`--source serverless --expand` per Next 16 CLI), parses both envelope and direct shapes, bounded concurrency, idempotent via the ingest endpoint's INSERT OR IGNORE.
7. ✅ **Implement `/api/rollup`.** Per-source aggregation into `rollup_daily`. Vercel Cron `15 0 * * *`. Endpoint guarded by `CRON_SECRET` with timing-safe compare. Supports `?day=` manual replay.
8. ✅ **Public `/` page.** SSR 5 charts with `force-dynamic`; reads `rollup_daily` for past days, computes today live from `events`.
9. ✅ **`/admin` page.** `proxy.ts` basic-auth gate (Next 16 rename of `middleware.ts`); events table with pagination + outcome filter, error feed, question clusters.
10. ✅ **`/admin/[id]` page.** Single-event drill-down with typed-fields KV list and pretty-printed `raw_json`. Prev/next neighbors via direct ts+source lookup.
    11a. ✅ **Apply zeroindex.ai design language.** Tailwind v4, full STYLE_GUIDE palette on `:root` (+ dashboard-only `--warn`/`--error` for outcome semantics), Tier B header matching `evals-site`, canonical 5-file favicon set.
11. ✅ **Custom domain.** Cloudflare DNS A record → `76.76.21.21`, gray-cloud; SSL auto-issued.
12. ✅ **Link from `zeroindex.ai`.** Observability use-case card gains a "See live traces →" link, mirroring the existing "See live evals →" pattern on the Truth principle card.
13. ✅ **Top-level README + Q&A snippets.** README reflects shipped state with links to live site and companion `eval-pack`.

---

## 9. Operational runbook

### Local development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm dev                                # Next.js on :3000

# run migrations against the local Turso URL
pnpm tsx --env-file=.env.local src/db/migrate.ts

# send a synthetic event for end-to-end smoke
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer ${TRACE_PACK_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @scripts/fixtures/sample-ok.json
```

### Configuration

Required env vars (production):

| Name                         | Purpose                                           |
| ---------------------------- | ------------------------------------------------- |
| `TURSO_DATABASE_URL`         | libsql connection string                          |
| `TURSO_AUTH_TOKEN`           | libsql auth                                       |
| `SOURCE_TOKEN_ASK_ZEROINDEX` | bearer token expected from `ask-zeroindex` ingest |
| `ADMIN_PASSWORD`             | basic-auth password for `/admin/*`                |
| `CRON_SECRET`                | shared secret for `/api/rollup`                   |

Optional env vars:

| Name             | Purpose                                                                        | Default         |
| ---------------- | ------------------------------------------------------------------------------ | --------------- |
| `DEFAULT_SOURCE` | the `source` the public `/` and `/admin` pages render when no source is chosen | `ask-zeroindex` |

Adding a new source = adding a new `SOURCE_TOKEN_<NAME>` env var + handing the value to that consumer. No code change.

### Adding a new event type (v0.2+)

1. Extend the Zod `IngestEvent` discriminator on `event`.
2. Either promote new fields to typed columns (migration) or rely on `raw_json` passthrough.
3. Add charts/views that consume the new type.

---

## 10. Decision log (running)

| Date       | Decision                                                   | Why                                                                                                                                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-15 | Direct POST ingestion, not Vercel Log Drains               | Contract clarity, consumer portability, no log-stream parsing.                                                                                                                                                                                                                                    |
| 2026-05-15 | Turso libsql, not a real time-series DB                    | At current consumer scale, SQLite is dramatically over-resourced.                                                                                                                                                                                                                                 |
| 2026-05-15 | Single-tenant UI, multi-tenant data model                  | Don't pay UI complexity for a second consumer that doesn't exist yet; don't pay schema migration when it does.                                                                                                                                                                                    |
| 2026-05-15 | Question text stored, never rendered publicly              | Aggregates are safe to publish; raw inputs stay behind auth.                                                                                                                                                                                                                                      |
| 2026-05-15 | SSR everything, no client-side data fetches                | Four-page dashboard, simple queries. Pay no SPA tax.                                                                                                                                                                                                                                              |
| 2026-05-15 | Basic auth on `/admin` for v0.1                            | Single-owner dashboard. Real auth provider waits for multi-user.                                                                                                                                                                                                                                  |
| 2026-05-15 | Daily rollup + on-the-fly today aggregation                | Cheap homepage queries without losing same-day visibility.                                                                                                                                                                                                                                        |
| 2026-05-16 | `favicon.ico` lives at `app/favicon.ico`, not `public/`    | Next 16 app-router intercepts `/favicon.ico` and 404s when the file is only in `public/`. App auto-injects the corresponding `<link>` tag; keep manual `<link>` tags only for the sized PNGs + SVG + apple-touch-icon which remain in `public/`.                                                  |
| 2026-05-16 | TURSO creds non-Sensitive on Vercel; tokens stay Sensitive | Vercel "Sensitive" env vars are not pullable via `vercel env pull`; running one-off migrations against prod requires the values reachable from the operator's terminal. Compromise: Turso URL+token are also stored in 1Password, the operator pulls via `op read` rather than `vercel env pull`. |

---

## 11. Known constraints & future work

### Resolved in v0.2 (were v0.1 constraints)

- ~~**One event type (`ask`).**~~ The schema is now a union; `ask` is one type, any other app sends a `GenericEvent`.
- ~~**One consumer.**~~ Multiple consumers (`ask-zeroindex`, `contract-lens`, intake-zero) + a source-aware UI.
- ~~**No cost metrics.**~~ Universal token core + derived `cost_usd` and a spend view.

### Still-current constraints

- **Basic auth only.** Fine for a single owner; replace before any second user gets `/admin` access.
- **No alerting.** Threshold breaches are visible on next page load, not pushed.

### Candidate work (post-v0.2)

- Threshold alerting: webhook on `error_rate_24h > X` or `p95_total_ms > Y`
- Live-tail view: server-sent events feeding a single tail page
- Question-cluster better than `hash` grouping: embedding-based similarity for grouping near-duplicate questions
- Per-event drill-down on the public page with question text redacted
- Per-source URLs (`traces.zeroindex.ai/s/<source>`) to complement the in-page source selector

### v0.2.1 polish backlog

Known P2-minor / P3 cleanups, tracked rather than chased.

- **Bound the `outcome` column for generic events.** Generic events currently store `outcome = outcomeReason ?? status`; setting `outcome = status` (and surfacing the reason only via `outcome_reason`) keeps `outcome` a bounded set. Mostly defensive — the admin already color-codes by the bounded `status`, not `outcome`.
- **Read-time fallback for not-yet-rolled-up days.** A day before the 00:15 UTC cron (or after a missed run) renders as 0/null with no live fallback. Either backfill-on-read for gaps or document the window explicitly.
- **`priceFor` match safety** (`src/lib/pricing.ts`). Use longest-match, or add a test asserting the price table is ordered most-specific-first, so a new model id can't be shadowed by a broader `claude-opus-4` prefix.
- **`dayBounds` half-open interval.** Use `ts >= start AND ts < nextDay` instead of the inclusive `<= endIso` upper bound, to drop the millisecond-boundary ambiguity.
- **Harden/annotate the rate-limit burst test.** It asserts the single-statement SQL guard serializes, not OS-level concurrency; annotate that explicitly, or drive true parallelism.

### v1.0 candidate work

- Stable public ingestion contract with semver guarantees
- Self-host story: documented Docker image + envs for someone who wants to run their own
- Multi-event-type schema (beyond `ask`): `embed`, `rerank`, `tool_call`, generic `event`
- A small client library (`@zeroindex-ai/trace-pack-client`) so consumers don't hand-roll the POST

---

## 12. Cross-references

- **Companion project (pre-prod correctness):** [`zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack)
- **First consumer:** [`zeroindex-ai/ask-zeroindex`](https://github.com/zeroindex-ai/ask-zeroindex)
- **Eval reports site:** [`zeroindex-ai/evals-site`](https://github.com/zeroindex-ai/evals-site) — `evals.zeroindex.ai`
- **Website repo:** [`zeroindex-ai/zeroindexai`](https://github.com/zeroindex-ai/zeroindexai)
- **This repo:** [`zeroindex-ai/trace-pack`](https://github.com/zeroindex-ai/trace-pack)
- **Live site:** `traces.zeroindex.ai`
- **v0.2 design spec:** [`docs/v0.2-multi-app-design.md`](./docs/v0.2-multi-app-design.md)

---

_This document is a living artifact. Update it when scope, contracts, or decisions change materially._
