/**
 * Pure parse + map logic for the backfill script.
 *
 * Input: one line of `vercel logs --json` output (or any line-delimited JSON
 * where each line is either an ask-trace directly or a Vercel log envelope
 * whose `.message` field is the ask-trace JSON string).
 *
 * Output: an IngestEvent ready to POST to /api/ingest, or null if the line
 * isn't an ask trace.
 */

export type AskTraceRaw = Record<string, unknown>;

export type IngestEventBody = {
  source: string;
  event: 'ask';
  ts: string;
  model: string;
  question: string;
  outcome: string;
  retrievedIds: number[];
  citationCount: number;
  retrievalMs: number;
  firstTokenMs: number | null;
  totalMs: number;
  errorMessage?: string;
};

function isAskTrace(o: unknown): o is AskTraceRaw {
  return typeof o === 'object' && o !== null && (o as Record<string, unknown>).event === 'ask';
}

/**
 * Try to extract an ask-trace object from a single JSON line. Tolerates two
 * shapes: (a) the trace directly, or (b) a Vercel log envelope where the
 * `message` field is a stringified JSON containing the trace.
 */
export function extractAskTrace(line: string): AskTraceRaw | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let outer: unknown;
  try {
    outer = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof outer !== 'object' || outer === null) return null;

  const o = outer as Record<string, unknown>;

  // (b) Vercel log envelope — `.message` is a JSON string
  if (typeof o.message === 'string') {
    try {
      const inner = JSON.parse(o.message);
      if (isAskTrace(inner)) return inner;
    } catch {
      // fall through to (a)
    }
  }

  // (a) direct ask trace
  if (isAskTrace(outer)) return outer as AskTraceRaw;

  return null;
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toIntArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    if (typeof x === 'number' && Number.isInteger(x)) out.push(x);
    else if (typeof x === 'string') {
      const n = Number(x);
      if (Number.isInteger(n)) out.push(n);
    }
  }
  return out;
}

const VALID_OUTCOMES = new Set(['ok', 'retrieval_failed', 'stream_failed', 'aborted']);

/**
 * Map a raw ask trace to an IngestEventBody. Returns null if required fields
 * are missing or invalid. Defaults `source` to `defaultSource` when absent
 * (pre-patch ask-zeroindex emissions didn't include `source`).
 */
export function toIngestEvent(
  trace: AskTraceRaw,
  defaultSource: string
): IngestEventBody | null {
  const source = typeof trace.source === 'string' && trace.source.length > 0
    ? trace.source
    : defaultSource;

  const ts = typeof trace.ts === 'string' ? trace.ts : null;
  const model = typeof trace.model === 'string' ? trace.model : null;
  const question = typeof trace.question === 'string' ? trace.question : null;
  const outcome = typeof trace.outcome === 'string' ? trace.outcome : null;

  if (!ts || !model || question === null || !outcome) return null;
  if (!VALID_OUTCOMES.has(outcome)) return null;

  const result: IngestEventBody = {
    source,
    event: 'ask',
    ts,
    model,
    question,
    outcome,
    retrievedIds: toIntArray(trace.retrievedIds),
    citationCount: toNumber(trace.citationCount, 0),
    retrievalMs: toNumber(trace.retrievalMs, 0),
    firstTokenMs: toNumberOrNull(trace.firstTokenMs),
    totalMs: toNumber(trace.totalMs, 0),
  };

  if (typeof trace.errorMessage === 'string' && trace.errorMessage.length > 0) {
    result.errorMessage = trace.errorMessage;
  }

  return result;
}
