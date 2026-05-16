import { describe, expect, it } from 'vitest';
import { extractAskTrace, toIngestEvent } from './backfill-parse';

const SAMPLE_TRACE = {
  source: 'ask-zeroindex',
  event: 'ask',
  ts: '2026-05-15T12:34:56.789Z',
  model: 'claude-sonnet-4-6',
  question: 'what services do you offer?',
  outcome: 'ok',
  retrievedIds: [42, 17, 9],
  citationCount: 2,
  retrievalMs: 412,
  firstTokenMs: 1180,
  totalMs: 4730,
};

describe('extractAskTrace', () => {
  it('returns null for empty and whitespace-only lines', () => {
    expect(extractAskTrace('')).toBeNull();
    expect(extractAskTrace('   ')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractAskTrace('{not json')).toBeNull();
  });

  it('returns null for JSON that is not an object', () => {
    expect(extractAskTrace('"a string"')).toBeNull();
    expect(extractAskTrace('null')).toBeNull();
    expect(extractAskTrace('[1, 2]')).toBeNull();
  });

  it('returns the trace directly when the line is an ask trace', () => {
    const line = JSON.stringify(SAMPLE_TRACE);
    expect(extractAskTrace(line)).toMatchObject({ event: 'ask', outcome: 'ok' });
  });

  it("unwraps a Vercel log envelope where .message is the trace's JSON", () => {
    const envelope = {
      level: 'info',
      message: JSON.stringify(SAMPLE_TRACE),
      timestamp: 1234567890,
    };
    const line = JSON.stringify(envelope);
    const trace = extractAskTrace(line);
    expect(trace).not.toBeNull();
    expect(trace?.event).toBe('ask');
    expect(trace?.question).toBe(SAMPLE_TRACE.question);
  });

  it('skips lines whose inner event is not ask', () => {
    const envelope = {
      message: JSON.stringify({ event: 'startup', ts: '2026-05-15T00:00:00Z' }),
    };
    expect(extractAskTrace(JSON.stringify(envelope))).toBeNull();
  });

  it('skips lines whose .message is not valid JSON', () => {
    const envelope = {
      message: 'plain log line, no JSON here',
    };
    expect(extractAskTrace(JSON.stringify(envelope))).toBeNull();
  });

  it('skips envelopes without event=ask anywhere', () => {
    const envelope = {
      level: 'info',
      message: 'starting up',
    };
    expect(extractAskTrace(JSON.stringify(envelope))).toBeNull();
  });
});

describe('toIngestEvent', () => {
  it('maps a complete trace to a valid IngestEventBody', () => {
    const result = toIngestEvent(SAMPLE_TRACE, 'fallback');
    expect(result).not.toBeNull();
    expect(result?.source).toBe('ask-zeroindex');
    expect(result?.event).toBe('ask');
    expect(result?.ts).toBe(SAMPLE_TRACE.ts);
    expect(result?.retrievedIds).toEqual([42, 17, 9]);
    expect(result?.firstTokenMs).toBe(1180);
  });

  it('defaults source when missing on the trace (pre-patch emissions)', () => {
    const withoutSource: Record<string, unknown> = { ...SAMPLE_TRACE };
    delete withoutSource.source;
    const result = toIngestEvent(withoutSource, 'ask-zeroindex');
    expect(result?.source).toBe('ask-zeroindex');
  });

  it('returns null when required fields are missing', () => {
    expect(toIngestEvent({ ...SAMPLE_TRACE, ts: undefined }, 'fallback')).toBeNull();
    expect(toIngestEvent({ ...SAMPLE_TRACE, model: undefined }, 'fallback')).toBeNull();
    expect(toIngestEvent({ ...SAMPLE_TRACE, question: undefined }, 'fallback')).toBeNull();
    expect(toIngestEvent({ ...SAMPLE_TRACE, outcome: undefined }, 'fallback')).toBeNull();
  });

  it('returns null on an unrecognized outcome', () => {
    expect(toIngestEvent({ ...SAMPLE_TRACE, outcome: 'half_failed' }, 'fallback')).toBeNull();
  });

  it('preserves firstTokenMs=null for failure outcomes', () => {
    const failed = { ...SAMPLE_TRACE, outcome: 'retrieval_failed', firstTokenMs: null };
    const result = toIngestEvent(failed, 'fallback');
    expect(result?.firstTokenMs).toBeNull();
    expect(result?.outcome).toBe('retrieval_failed');
  });

  it('drops non-integer entries from retrievedIds', () => {
    const dirty = { ...SAMPLE_TRACE, retrievedIds: [1, 'two', 3.5, 4, null] };
    const result = toIngestEvent(dirty, 'fallback');
    expect(result?.retrievedIds).toEqual([1, 4]);
  });

  it('attaches errorMessage when present and non-empty', () => {
    const trace = { ...SAMPLE_TRACE, outcome: 'stream_failed', errorMessage: 'rate limit hit' };
    const result = toIngestEvent(trace, 'fallback');
    expect(result?.errorMessage).toBe('rate limit hit');
  });

  it('omits errorMessage when empty or absent', () => {
    const result = toIngestEvent(SAMPLE_TRACE, 'fallback');
    expect(result?.errorMessage).toBeUndefined();

    const empty = { ...SAMPLE_TRACE, errorMessage: '' };
    expect(toIngestEvent(empty, 'fallback')?.errorMessage).toBeUndefined();
  });
});
