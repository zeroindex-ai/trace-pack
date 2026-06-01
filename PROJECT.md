# trace-pack — Project Documentation

> **Phase:** Production · **Status:** shipped v0.2
> **Live:** [traces.zeroindex.ai](https://traces.zeroindex.ai) · **Repo:** github.com/zeroindex-ai/trace-pack

A minimal, opinionated LLM observability dashboard for small Claude-based applications. A
consumer app POSTs a structured event per request; `trace-pack` stores, aggregates, and
renders. Built for a Claude-app author specifically (first-token latency, citation-count
distribution, retrieved-id heatmap, cost) — not a generic APM.

> **Section convention:** every numbered section below is expected. If one genuinely
> doesn't apply, the heading is kept with `— n/a: [reason]`. Family/repo-specific sections
> follow §8.

> **What changed in v0.2 (shipped 2026-05-23–25).** v0.1 was a single `ask`-shaped RAG
> schema with a single-source UI. v0.2 generalized it into a **universal event core** every
> Claude app shares — a coarse `status` axis (`ok`/`error`/`aborted`), input/output/cache
> token counts, and a derived `cost_usd` — plus a per-event-type extension (`ask` is now
> just one event type; any other app sends a `GenericEvent`). The dashboard became
> **source-aware** (multiple consumers + a source selector) and gained a **cost/spend
> axis**. It now observes `ask-zeroindex`, `contract-lens`, and intake-zero via their
> dual-write paths. The authoritative spec is [`docs/v0.2-multi-app-design.md`](./docs/v0.2-multi-app-design.md)
> (marked shipped); the sections below carry one-line `(v0.2)` pointers where the generalized
> model changed a v0.1 detail, rather than re-narrating the change each time.

---

## 1. Why this exists

The eval methodology (`eval-pack`) tells you whether your LLM app gets answers right on a
curated golden set. It says nothing about what real users actually ask, how latency behaves
under real load, what fraction of requests fail in production, or which retrieved chunks
dominate. Most teams glue this together from a logging vendor, a chart library, and three
SQL queries — but the _interesting_ metrics for a small Claude app (first-token latency,
citation-count distribution, retrieved-id heatmap, per-request cost) are not what a generic
APM gives you.

- **Lifted from a real consumer.** The first consumer is [`ask-zeroindex`](https://github.com/zeroindex-ai/ask-zeroindex),
  which already emits the exact event shape this project ingests (`app/api/ask` `logAsk` in
  that repo). The work is generalization, storage, and presentation — not greenfield
  instrumentation.
- **Opinionated, not generic.** Not an OTel collector. A dashboard with a defined event
  schema (a universal core + an `ask` extension, not arbitrary spans), a handful of pages,
  and a small set of author-useful metrics.
- **Multi-tenant from the data up.** The data model carried a `source` tenant key from day
  one; v0.1 rendered one source, v0.2 made the UI source-aware — and, as designed, adding
  consumers needed no schema migration of the core key.

**Companion to [`eval-pack`](https://github.com/zeroindex-ai/eval-pack):** `eval-pack` =
pre-prod correctness (a file-producing library you import, run in CI, one HTML report per
run); `trace-pack` = post-prod behavior (a hosted dashboard you point your app at, ingesting
events continuously and rendering aggregate views over time).

### Goals & success criteria

| Goal | How I'll know it's met | Status |
| --- | --- | --- |
| Public dashboard live | `traces.zeroindex.ai` serves real `ask-zeroindex` traffic | ✅ |
| Ingestion contract documented | `POST /api/ingest` accepts `ask-zeroindex`'s current event verbatim | ✅ |
| Zero perceptible consumer latency | `ask-zeroindex` `logAsk` completes <1ms p99 (fire-and-forget POST) | ✅ |
| Linked from the marketing site | `zeroindex.ai` Observability card has a "See live traces →" link | ✅ |
| Owner-only admin view | `/admin` shows full traces, error feed, drill-down behind auth | ✅ |
| Daily rollup keeps homepage cheap | Homepage SSR fetches one row per visible day, not raw events | ✅ |
| Multi-app + cost (v0.2) | Source-aware UI + universal status axis + spend view live | ✅ |

**Out of scope (v0.1, still deferred unless noted):**

- **Real-time / live-tail view.** Daily rollup + on-demand reload covers current traffic.
- **Alerting / paging.** Threshold breaches → notifications belong once we know which
  thresholds matter in practice.
- **Full OpenTelemetry** (spans, parent IDs, distributed propagation). A flat
  event-per-request model is enough for the current consumers.
- **Log-drain ingestion.** Direct POST is the chosen path (see §2).
- **Question full-text search.** Turso FTS5 is available; defer until volume makes it useful.
- **Public per-event drill-down.** Aggregate views only on the public homepage; per-event
  detail is auth-gated.
- **Telemetry / phone-home / usage analytics.** Never.
- _Shipped in v0.2 (were out of scope in v0.1):_ multi-tenant UI; cost tracking
  (`inputTokens`/`outputTokens`/$ per request, now the universal token core + derived
  `cost_usd` in `src/lib/pricing.ts`).

## 2. Strategic decisions

### Tech stack

| Choice | Why this | Alternative rejected |
| --- | --- | --- |
| Next.js 16 (app router) on Vercel Pro | Consistent with `ask-zeroindex`. App Router + Server Components SSR every chart server-side — no client-side data fetching, no SPA-router complexity for a few-page site. | A client-side SPA dashboard — adds `useEffect`-to-fetch, loading skeletons, client/server data drift for no benefit. |
| Turso / libsql | Consistent with `ask-zeroindex`. The query shapes here (aggregate by day, percentile over a window, top-N by group) are exactly what SQLite is good at. | ClickHouse / Tinybird / a real time-series DB — dramatically over-resourced at single-digit req/min; Turso scales sideways far longer than this project will need. |
| Recharts | Mature, declarative, SSR-friendly; the data shapes (time-series + bars + histograms) are simple. | D3 — overkill for these shapes. |
| Zod | Already in the stack via `ask-zeroindex`/`eval-pack`. Used at the ingest boundary + on the rollup contract. | — |
| Basic auth on `/admin` via root `proxy.ts` + single `ADMIN_PASSWORD` | Smallest viable surface for a single-owner dashboard. | A real auth provider — waits for a second admin user. |
| vitest · pnpm 10 · Vercel | House default. Node 24 in CI/dev; `engines` floor `>=20` so it still installs on any current LTS. | — |
| MIT license | Matches `eval-pack` and `mcp-pack`. | — |

### Key decisions

Non-obvious choices + the alternatives rejected, each kept so it can be re-litigated later.

- **Direct POST ingestion, not Vercel Log Drains.** `POST /api/ingest` with a per-source
  bearer token, one event per request. A 5-line consumer change that keeps stdout intact
  for Vercel-side diagnostics and gives `trace-pack` a contract it controls. Log drains
  were rejected because they (1) deliver _all_ function logs, forcing a parse of a noisy
  unstructured stream filtered on `event=ask`; (2) tie the contract to Vercel-hosted
  consumers; (3) make multi-source coordination painful (one drain per source).
- **Store the full payload as `raw_json`; promote known fields to typed columns.** New
  fields from consumers are never rejected; typed columns get added in later migrations and
  back-filled from `raw_json`. This is what `passthrough()` on the Zod schema buys (see §4).
- **`source` column on every row, indexed with `ts`.** Multi-tenancy is a token + a UI
  selector — no schema change. Shipped one source in v0.1, source-aware UI in v0.2.
- **Question text stored server-side, never rendered on the public homepage**, rendered on
  the auth-gated admin view. The privacy-sensitive content stays behind auth; the public
  face is aggregates only. (Per-event public drill-down rejected for the same reason —
  user-typed questions are the only field that could leak.)
- **Daily rollup + on-the-fly "today" aggregation.** Vercel Cron refreshes `rollup_daily`
  at 00:15 UTC; the homepage reads one row per visible day plus a single live aggregation
  for the in-flight day. Avoids percentile-over-30-days queries on every page load.
- **JS percentile computation over the day window**, since SQLite has no native percentile
  UDF. Honest p50/p95/p99 without external tools; fine at this traffic.
- **`(source, ts, dedup_hash)` natural key with `INSERT OR IGNORE`** for idempotency. A
  consumer retry (network blip, deploy restart) collapses to a no-op. Not _strict_
  idempotency — two genuinely-different requests with the same question and
  millisecond-identical timestamp would collapse — but that collision is vanishingly rare
  and the failure mode (one row instead of two) is benign.
- **Rate limit before any parse/auth work.** A public POST must not let one origin burn CPU
  on parse + Zod + token-compare, or grow `events` unbounded — a dedupe hash is not a rate
  limit. Turso-backed token bucket, per-IP key (UA+lang fingerprint fallback), capacity 60,
  refill 1 token/sec, returns 429 + `Retry-After` (`src/lib/rateLimit.ts`). Generous for
  legitimate server-to-server volume; throttles single-origin floods. Distributed/botnet
  floods are explicitly out of scope — those want an edge/WAF limit, not an app bucket.
- **Server-side question redaction reserved, ships empty.** The current consumers are
  low-PII; an optional `redactQuestion` hook is in the schema for when that changes.

**Deliberately NOT chosen** (the "why not" matters as much as the "why"):

| Avoided | Why |
| --- | --- |
| **Vercel Log Drains** as the ingestion path | See "Direct POST" above — noisy all-logs stream, Vercel-only contract, painful multi-source. |
| **ClickHouse / Tinybird / a real time-series DB** | At single-digit req/min peak, SQLite is dramatically over-resourced. The day a consumer justifies ClickHouse is the day we're long past this project's scale. |
| **Full OpenTelemetry** | OTel pays back with multiple services needing distributed propagation. A single app emitting one event/request gets nothing from spans/baggage. |
| **A client-side SPA dashboard** | Server Components SSR the charts — no fetch-on-mount, no skeletons, no data drift. Data that updates on page load is fast enough. |
| **A separate "logs" view** | The events table _is_ the logs view. Splitting them is ceremony. |
| **Per-event public drill-down** | User-typed questions could leak; aggregates are safe, raw events stay behind auth. |

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                Consumer app (e.g. ask-zeroindex)                     │
│   logAsk(trace)                                                       │
│     ├── console.log(...)         ← unchanged; preserves Vercel logs   │
│     └── POST traces.zeroindex.ai/api/ingest  (if TRACE_PACK_URL set)   │
│         Authorization: Bearer ${TRACE_PACK_TOKEN}                     │
└──────────────────────────────────────────────────────────────────────┘
                              │ fire-and-forget, keepalive
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    trace-pack (Next.js on Vercel Pro)                │
│   app/api/ingest/route.ts   POST handler, rate-limit → auth → Zod    │
│   app/api/rollup/route.ts   Cron-invoked daily aggregation           │
│   app/page.tsx              public aggregate dashboard (SSR)          │
│   app/admin/page.tsx        auth-gated events + errors + clusters     │
│   app/admin/[id]/page.tsx   single-event drill-down                   │
│   proxy.ts (repo root)      Basic auth on /admin/*                    │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          Turso libsql                                 │
│   events        append-only event store + raw_json passthrough        │
│   rollup_daily  one row per (source, day) for cheap homepage SSR      │
└──────────────────────────────────────────────────────────────────────┘
```

### Write path (per event)

```
Consumer logAsk()
   ├─→ POST /api/ingest  { source, event, ts, model, … (ask or generic shape) }
   ├─→ Rate-limit check (token bucket) BEFORE any parse/auth — 429 + Retry-After if over
   ├─→ Verify bearer token against the source's expected token (timing-safe compare)
   ├─→ Zod-validate the envelope; reject 400 on bad shape
   ├─→ Derive cost_usd (src/lib/pricing.ts) and dedup_hash = sha256(question)
   ├─→ INSERT OR IGNORE into events (UNIQUE source, ts, dedup_hash)
   └─→ 204 No Content
```

### Read path

- **Public `/`** — server component reads `rollup_daily` for the last 30 days + one
  in-flight aggregation for "today" from `events`. SSR charts. Source-aware (v0.2): a
  multi-app overview + per-source selector.
- **Admin `/admin`** — server component paginates `events` (default filter
  `outcome != 'ok'`, or all), plus the error feed and question clusters.
- **Admin `/admin/[id]`** — reads one event row, renders the full `raw_json` plus typed
  fields and prev/next neighbors by ts.

### UI surfaces

> Source-aware (v0.2): `ask`-specific charts (citation histogram, top retrieved IDs,
> first-token latency) render for `ask` sources; non-`ask` sources show the universal
> status + cost + latency surfaces. Full UI spec: `docs/v0.2-multi-app-design.md` §4.

- **Public `/` (aggregate-only):** traffic sparkline (events/day, 30d); outcome stacked bar
  (ok / retrieval_failed / stream_failed / aborted per day); latency percentiles
  (p50/p95/p99 for `totalMs` and `firstTokenMs`); citation-count histogram; top retrieved
  IDs (proxy for "which content is doing the work"); spend chart (v0.2). Question text is
  never rendered here.
- **Admin `/admin` (auth-gated):** events table (paginated, newest-first, outcome filter);
  error feed (`outcome != 'ok'`); question clusters (group by `dedup_hash` — the "what do
  users actually ask" view).
- **Admin `/admin/[id]`:** full event detail — every typed field, the full `raw_json`, prev/next links.

All charts SSR — no loading skeletons, no client-side fetches. The public page is one
bundle with no auth check (served from Vercel's CDN). `/admin/*` uses Basic auth via
`proxy.ts` — no session, no cookie; the browser handles it.

## 4. Public contract

### Ingestion: `POST /api/ingest`

Request — an `ask`-type event (still valid verbatim, so `ask-zeroindex` needed no wire
change; as of v0.2 it's one of two accepted shapes):

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

Response: `204 No Content` on success, `400` on schema violation, `401` on bad/missing
token, `429` + `Retry-After` when rate-limited, `502` on storage failure.

Zod schema (v0.2 — a union of `ask` and everything else; authoritative source is
`src/ingest/schema.ts`):

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

The `passthrough()` is load-bearing: it's the forward-compatibility guarantee. Consumers
can add fields without coordinating with `trace-pack`; per-type fields ride along in
`raw_json` and are promoted to columns only when a chart needs them. An `ask` event's
`status` is derived from its `outcome` (`*_failed → error`); other events send `status`
directly.

### Cron: `GET /api/rollup`

Vercel Cron–invoked once per day at 00:15 UTC (Cron issues `GET`; guarded by `CRON_SECRET`
with a timing-safe compare; supports `?day=` manual replay). Aggregates yesterday's `events`
into `rollup_daily`. Idempotent (`INSERT OR REPLACE`).

## 5. Data model

Authoritative DDL: `src/db/migrations/` (001–005). The block below is the **current (v0.2)
shape** — the v0.1 `events` table plus the universal core that migration `004` added. v0.2
columns are marked.

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

> **v0.2 rollup note.** The `ok`/`retrieval_failed`/`stream_failed`/`aborted` and
> `avg_citations`/`first_token` columns are the `ask`-specific rollup; migration 005 added
> the universal `n_ok`/`n_error`/`n_aborted` status counts and the `sum_cost_usd`/`sum_*_tokens`
> spend dimension so the multi-app overview + spend views read precomputed numbers. Status
> counts backfilled from the ask outcomes; token/cost sums are NULL for pre-token days and
> fill forward.

**Why these indexes:**

- `(source, ts DESC)` — every dashboard query is "events for source X over the last N days,
  newest first." The workhorse.
- `(source, outcome)` — the error feed on `/admin` filters by outcome.
- `(source, dedup_hash)` — supports the "show me every time someone asked this question"
  cluster view on `/admin`.

**Why the `UNIQUE` constraint matters:** see the idempotency decision in §2 — the
`(source, ts, dedup_hash)` triple makes a retried ingest a no-op via `INSERT OR IGNORE`.

## 6. Project structure

```
trace-pack/
├── app/
│   ├── page.tsx                 public aggregate dashboard (SSR, force-dynamic)
│   ├── layout.tsx               root layout
│   ├── HeaderNav.tsx            Tier-B header / nav chrome
│   ├── globals.css              design tokens (mirrors STYLE_GUIDE :root)
│   ├── favicon.ico              app-router favicon (must live here, not public/)
│   ├── api/
│   │   ├── ingest/route.ts      POST ingestion endpoint
│   │   └── rollup/route.ts      Vercel Cron daily aggregator
│   └── admin/
│       ├── page.tsx             events + errors + clusters
│       └── [id]/page.tsx        single-event drill-down
├── proxy.ts                     Basic-auth gate on /admin/* (Next 16 — was middleware.ts in 15)
├── src/
│   ├── db/
│   │   ├── client.ts            Turso libsql client (lazy singleton + undici-fetch workaround)
│   │   ├── migrations/
│   │   │   ├── 001_init.sql
│   │   │   ├── 002_rollup.sql
│   │   │   ├── 003_rate_limit.sql
│   │   │   ├── 004_multi_app.sql      v0.2: universal core (status+tokens+cost), question_hash→dedup_hash
│   │   │   └── 005_rollup_multi_app.sql  v0.2: status + spend rollup columns
│   │   └── migrate.ts           runs every migration in order; tracked in schema_migrations
│   ├── ingest/
│   │   ├── schema.ts            Zod IngestEvent union (AskEvent | GenericEvent)
│   │   ├── handler.ts           rate-limit → auth → cost → write orchestration
│   │   ├── auth.ts              bearer-token resolution from env
│   │   └── write.ts            insert-or-ignore wrapper
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
│   │   ├── TopRetrieved.tsx
│   │   └── SpendChart.tsx       v0.2: token/cost spend view
│   ├── components/
│   │   └── SourceSwitcher.tsx   v0.2: source selector
│   └── lib/
│       ├── backfill-parse.ts    pure parse + map logic for the backfill script
│       ├── dates.ts             UTC day-offset helpers
│       ├── format.ts            canonical admin timestamp/number formatting
│       ├── palette.ts           chart color tokens mirroring globals.css :root
│       ├── pricing.ts           v0.2: per-model token→cost_usd table + derivation
│       ├── rateLimit.ts         Turso-backed token bucket for /api/ingest
│       └── timingSafeCompare.ts constant-time string equality
├── scripts/
│   ├── backfill.ts              read vercel logs --json, POST to /api/ingest
│   ├── migrate-prod.ts          one-off migration runner vs a non-local Turso DB
│   └── seed-local.ts            seed a local file:db with fake traffic
├── package.json
├── tsconfig.json
├── next.config.ts
├── vitest.config.ts
├── vercel.json                  Cron config for /api/rollup (15 0 * * *)
├── .github/workflows/ci.yml     typecheck + lint + test + build on PRs (Node 24)
├── PROJECT.md                   this file
├── README.md                    user-facing intro
└── LICENSE                      MIT
```

## 7. Distribution

`traces.zeroindex.ai` on Vercel Pro (Cloudflare DNS-only: A record → `76.76.21.21`,
gray-cloud, SSL auto-issued). Prod state in a Turso libsql DB. Deploy via the
`deploy-zeroindex-vercel-app` skill (Turso → Vercel env → migrations → domain). Linked from
`zeroindex.ai`'s Observability use-case card ("See live traces →").

Companion repos it reads from / writes to: ingests from `ask-zeroindex` (and now
`contract-lens`, intake-zero) via their `logAsk`-style dual-write; the consumer-side helper
was extracted to `src/lib/logAsk.ts` in `ask-zeroindex` (env-gated, fire-and-forget POST
with `keepalive: true`, errors swallowed so it never throws to the route).

### Configuration

| Env var | Required? | Purpose / default |
| --- | --- | --- |
| `TURSO_DATABASE_URL` · `TURSO_AUTH_TOKEN` | yes | prod libsql connection + auth |
| `ADMIN_PASSWORD` | yes | `/admin/*` Basic Auth |
| `SOURCE_TOKEN_ASK_ZEROINDEX` | yes | bearer token expected from the `ask-zeroindex` ingest; one `SOURCE_TOKEN_<UPPER_SOURCE>` per consumer |
| `CRON_SECRET` | yes | shared secret required by `/api/rollup` (set in Vercel Cron config) |
| `DEFAULT_SOURCE` | no | source rendered by `/` and `/admin` when none is chosen. Default `ask-zeroindex` |

Adding a new source = a new `SOURCE_TOKEN_<NAME>` env var + handing the value to that
consumer. No code change.

> **Vercel env-pull constraint:** Turso URL+token are kept **non-Sensitive** on Vercel
> (Sensitive vars aren't pullable via `vercel env pull`, and one-off prod migrations need
> the values reachable from the operator's terminal). They're also in 1Password; the
> operator pulls via `op read` rather than `vercel env pull`. Tokens stay Sensitive.

**Adding a new event type (v0.2+):** extend the Zod `IngestEvent` union on `event` →
either promote new fields to typed columns (a new numbered migration) or rely on `raw_json`
passthrough → add charts/views that consume the new type.

## 8. Testing & evaluation

Unit + integration tests with **vitest** (`vitest.config.ts`); **133 test cases across 13
`*.test.ts` files**, co-located next to source. No separate e2e suite or AI-eval harness —
this is observability infrastructure, not a model app, so there is no golden set / headline
metric (that's `eval-pack`'s job, the pre-prod-correctness companion).

What's covered:

- **Ingest boundary** — `src/ingest/schema.test.ts` (the `AskEvent | GenericEvent` union,
  `passthrough`, the open non-ask discriminator) and `src/ingest/handler.test.ts`
  (rate-limit → auth → cost → write orchestration end-to-end).
- **Persistence + migrations** — `src/db/migrate.test.ts` asserts the runner applies 001–005
  in order and is idempotent (re-running yields `[]`). DB-touching tests run against an
  **in-memory libsql** (`createClient({ url: ':memory:' })`) — real SQL, no network, no
  fixtures DB.
- **Queries** — `src/queries/{homepage,admin,rollup,sources}.test.ts` exercise the SQL each
  UI surface depends on against the in-memory DB.
- **Lib** — `rateLimit` (the token-bucket guard), `pricing` (token→`cost_usd` derivation),
  `timingSafeCompare`, `dates`, `format`, `backfill-parse`.

**CI gate** (`.github/workflows/ci.yml`, on every PR + push to `main`, Node 24, pnpm
frozen-lockfile): `pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm build`. All four must
pass; `build` is part of the gate because a `next build` regression (e.g. a top-level
`env()` breaking preview deploys) won't surface in unit tests.

> Known test-hardening items (rate-limit burst test asserts SQL-guard serialization not OS
> concurrency; `priceFor` longest-match ordering) are tracked in §"Known constraints" v0.2.1
> backlog.

---

## Ordered work list

v0.1 + v0.2 shipped end-to-end; remaining items are the v0.2.1 polish backlog and
post-v0.2/v1.0 candidates in "Known constraints" below. Shipped milestones:

- [x] Scaffold (Next 16, ESLint, Vitest, CI, MIT) · Turso DB provisioned (creds in 1Password + Vercel)
- [x] Migrations 001–005 with idempotent runner (`src/db/migrate.ts`) + one-off prod runner (`scripts/migrate-prod.ts`)
- [x] `POST /api/ingest` — Zod `passthrough`, per-source bearer auth (`SOURCE_TOKEN_<NAME>`), timing-safe compare, `INSERT OR IGNORE`, rate-limit guard
- [x] `ask-zeroindex` `logAsk` patched (extracted helper, env-gated fire-and-forget `keepalive` POST)
- [x] Backfill script (`scripts/backfill.ts`, reads `vercel logs --source serverless --expand`, bounded concurrency, idempotent)
- [x] `GET /api/rollup` — per-source aggregation, Vercel Cron `15 0 * * *`, `CRON_SECRET`-guarded, `?day=` replay
- [x] Public `/` (5 charts, `force-dynamic`) · `/admin` (events table + filter, error feed, clusters) · `/admin/[id]` drill-down
- [x] zeroindex.ai design language (Tailwind v4, STYLE_GUIDE palette, Tier-B header, 5-file favicon)
- [x] Custom domain + link from `zeroindex.ai` + README
- [x] **v0.2** — universal core (status + tokens + `cost_usd`), source-aware UI + selector, spend view, multi-consumer (`ask-zeroindex`, `contract-lens`, intake-zero)

## Decision log (running)

Newest first. Dated. Rationale lives in §2 — entries forward-reference rather than restate.

- **2026-05-23–25** — Shipped v0.2: generalized the `ask`-shaped schema into a universal
  event core (status + tokens + `cost_usd`) + per-type extension; source-aware UI; spend
  axis. Spec: `docs/v0.2-multi-app-design.md`. (§5 migrations 004/005.)
- **2026-05-16** — `favicon.ico` lives at `app/favicon.ico`, not `public/`. Next 16
  app-router intercepts `/favicon.ico` and 404s when the file is only in `public/`; the app
  auto-injects the `<link>` for it. Sized PNGs + SVG + apple-touch stay in `public/` with
  manual `<link>`s.
- **2026-05-16** — Turso creds kept non-Sensitive on Vercel; tokens stay Sensitive. (See the
  env-pull constraint note in §7.)
- **2026-05-15** — Direct POST ingestion, not Vercel Log Drains. (§2)
- **2026-05-15** — Turso libsql, not a real time-series DB. (§2)
- **2026-05-15** — Single-tenant UI on a multi-tenant data model. (§2 — later realized by v0.2.)
- **2026-05-15** — Question text stored, never rendered publicly. (§2)
- **2026-05-15** — SSR everything, no client-side data fetches. (§2)
- **2026-05-15** — Basic auth on `/admin` for v0.1. (§2)
- **2026-05-15** — Daily rollup + on-the-fly "today" aggregation. (§2)

## Known constraints & future work

**Still-current constraints:**

- **Basic auth only.** Fine for a single owner; replace before any second user gets `/admin`
  access.
- **No alerting.** Threshold breaches are visible on next page load, not pushed.

**v0.2.1 polish backlog** (P2-minor / P3, tracked rather than chased):

- **Bound the `outcome` column for generic events.** Generic events currently store
  `outcome = outcomeReason ?? status`; setting `outcome = status` (surfacing the reason only
  via `outcome_reason`) keeps `outcome` a bounded set. Mostly defensive — the admin already
  color-codes by the bounded `status`, not `outcome`.
- **Read-time fallback for not-yet-rolled-up days.** A day before the 00:15 UTC cron (or
  after a missed run) renders as 0/null with no live fallback. Either backfill-on-read for
  gaps or document the window explicitly.
- **`priceFor` match safety** (`src/lib/pricing.ts`). Use longest-match, or add a test
  asserting the price table is ordered most-specific-first, so a new model id can't be
  shadowed by a broader `claude-opus-4` prefix.
- **`dayBounds` half-open interval.** Use `ts >= start AND ts < nextDay` instead of the
  inclusive `<= endIso` upper bound, to drop the millisecond-boundary ambiguity.
- **Harden/annotate the rate-limit burst test.** It asserts the single-statement SQL guard
  serializes, not OS-level concurrency; annotate that explicitly, or drive true parallelism.

**Candidate work (post-v0.2):**

- Threshold alerting: webhook on `error_rate_24h > X` or `p95_total_ms > Y`.
- Live-tail view: server-sent events feeding a single tail page.
- Better question clustering than `hash`: embedding-based similarity for near-duplicates.
- Per-event drill-down on the public page with question text redacted.
- Per-source URLs (`traces.zeroindex.ai/s/<source>`) to complement the in-page selector.

**v1.0 candidate work:**

- Stable public ingestion contract with semver guarantees.
- Self-host story: documented Docker image + envs.
- More built-in event types beyond `ask`: `embed`, `rerank`, `tool_call`, generic `event`.
- A small client library (`@zeroindex-ai/trace-pack-client`) so consumers don't hand-roll the POST.

## Cross-references

- **Companion (pre-prod correctness):** [`zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack)
- **First consumer:** [`zeroindex-ai/ask-zeroindex`](https://github.com/zeroindex-ai/ask-zeroindex)
- **Eval reports site:** [`zeroindex-ai/evals-site`](https://github.com/zeroindex-ai/evals-site) — `evals.zeroindex.ai`
- **Website:** [zeroindex.ai](https://zeroindex.ai) — Astro site (source in the private `zeroindex-site` repo)
- **This repo:** [`zeroindex-ai/trace-pack`](https://github.com/zeroindex-ai/trace-pack) — live at `traces.zeroindex.ai`
- **v0.2 design spec:** [`docs/v0.2-multi-app-design.md`](./docs/v0.2-multi-app-design.md)

---

_This document is a living artifact. Update it when scope, contracts, or decisions change materially._
</content>
</invoke>
