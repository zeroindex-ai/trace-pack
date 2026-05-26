import { z } from 'zod';

// Granular `ask` outcomes (the original RAG vocabulary). Kept for back-compat:
// ask-zeroindex still POSTs `outcome`, and the admin filter still uses these.
export const OUTCOMES = ['ok', 'retrieval_failed', 'stream_failed', 'aborted'] as const;
export type Outcome = (typeof OUTCOMES)[number];

// The universal, cross-app status axis. Every event resolves to one of these
// (derived from `outcome` for `ask`, sent directly by other event types).
export const STATUSES = ['ok', 'error', 'aborted'] as const;
export type Status = (typeof STATUSES)[number];

// Common core every event carries. `model`/`totalMs` are optional here and
// tightened on the `ask` branch (which always has them).
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
  // Consumer-supplied precise cost in micro-USD (USD × 1e6, integer). For
  // consumers that make multiple model calls per event and compute their own
  // cost (e.g. repo-xray), omitting `model`/tokens. Used as a fallback when the
  // model+tokens don't yield a token-derived price (see write.ts).
  costMicroUsd: z.number().int().min(0).nullable().optional(),
};

// The `ask` extension — the original RAG Q&A shape, unchanged on the wire so
// ask-zeroindex needs no change. `passthrough()` keeps forward-compat.
export const AskEvent = z
  .object({
    ...coreFields,
    event: z.literal('ask'),
    model: z.string().min(1),
    totalMs: z.number().int().min(0),
    outcome: z.enum(OUTCOMES),
    question: z.string().min(1).max(2000),
    retrievedIds: z.array(z.number().int()).default([]),
    citationCount: z.number().int().min(0),
    retrievalMs: z.number().int().min(0),
    firstTokenMs: z.number().int().min(0).nullable(),
  })
  .passthrough();

// Any non-`ask` event type. Sends the universal `status` directly plus an
// optional app-specific `outcomeReason`; per-type fields ride along in the
// body and are preserved via passthrough (promoted to columns only when a
// chart needs them — design §2.3). `idempotencyKey` overrides the dedup hash.
export const GenericEvent = z
  .object({
    ...coreFields,
    event: z
      .string()
      .min(1)
      .max(64)
      .refine((e) => e !== 'ask', { message: "event 'ask' must use the ask schema" }),
    status: z.enum(STATUSES),
    outcomeReason: z.string().min(1).max(120).nullable().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .passthrough();

// Union, not discriminatedUnion: the non-ask branch's discriminator is open
// (any string ≠ 'ask'), which a discriminated union can't express. `ask` matches
// AskEvent; everything else falls through to GenericEvent.
export const IngestEvent = z.union([AskEvent, GenericEvent]);

export type AskEvent = z.infer<typeof AskEvent>;
export type GenericEvent = z.infer<typeof GenericEvent>;
export type IngestEvent = z.infer<typeof IngestEvent>;

export function isAsk(e: IngestEvent): e is AskEvent {
  return e.event === 'ask';
}

// Resolves the stored outcome triple: the coarse `status`, the legacy `outcome`
// column (specific label — required NOT NULL), and the nullable `outcomeReason`.
export function deriveOutcome(e: IngestEvent): {
  status: Status;
  outcome: string;
  outcomeReason: string | null;
} {
  if (isAsk(e)) {
    const status: Status = e.outcome === 'ok' ? 'ok' : e.outcome === 'aborted' ? 'aborted' : 'error';
    const outcomeReason =
      e.outcome === 'retrieval_failed' || e.outcome === 'stream_failed' ? e.outcome : null;
    return { status, outcome: e.outcome, outcomeReason };
  }
  const outcomeReason = e.outcomeReason ?? null;
  return { status: e.status, outcome: outcomeReason ?? e.status, outcomeReason };
}
