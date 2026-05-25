import { describe, expect, it } from 'vitest';
import { IngestEvent, deriveOutcome, isAsk } from './schema';

function parse(body: unknown) {
  const r = IngestEvent.safeParse(body);
  if (!r.success) throw new Error(`expected valid: ${r.error.message}`);
  return r.data;
}

const askBase = {
  source: 'ask-zeroindex',
  event: 'ask',
  ts: '2026-05-25T12:00:00.000Z',
  model: 'claude-sonnet-4-6',
  question: 'what is this?',
  outcome: 'ok',
  retrievedIds: [1, 2],
  citationCount: 2,
  retrievalMs: 100,
  firstTokenMs: 400,
  totalMs: 1500,
};

const genericBase = {
  source: 'contract-lens',
  event: 'extract',
  ts: '2026-05-25T12:00:00.000Z',
  model: 'claude-sonnet-4-6',
  status: 'ok',
  totalMs: 5000,
};

describe('IngestEvent parsing (ask | generic union)', () => {
  it('accepts a valid ask event', () => {
    expect(isAsk(parse(askBase))).toBe(true);
  });

  it('accepts a valid generic event and routes it to the generic branch', () => {
    expect(isAsk(parse(genericBase))).toBe(false);
  });

  it('rejects a malformed ask (event=ask but missing RAG fields)', () => {
    // Fails AskEvent (missing question/citationCount/…) and GenericEvent refuses 'ask'.
    const bad = { source: 'ask-zeroindex', event: 'ask', ts: askBase.ts, outcome: 'ok' };
    expect(IngestEvent.safeParse(bad).success).toBe(false);
  });

  it("rejects a generic-shaped event that reuses event:'ask'", () => {
    expect(IngestEvent.safeParse({ ...genericBase, event: 'ask' }).success).toBe(false);
  });

  it('rejects a generic event with no status', () => {
    const bad = { source: 'contract-lens', event: 'extract', ts: genericBase.ts };
    expect(IngestEvent.safeParse(bad).success).toBe(false);
  });
});

describe('deriveOutcome', () => {
  it('maps ask outcomes to status + reason', () => {
    expect(deriveOutcome(parse({ ...askBase, outcome: 'ok' }))).toEqual({
      status: 'ok',
      outcome: 'ok',
      outcomeReason: null,
    });
    expect(deriveOutcome(parse({ ...askBase, outcome: 'retrieval_failed' }))).toEqual({
      status: 'error',
      outcome: 'retrieval_failed',
      outcomeReason: 'retrieval_failed',
    });
    expect(deriveOutcome(parse({ ...askBase, outcome: 'stream_failed' }))).toEqual({
      status: 'error',
      outcome: 'stream_failed',
      outcomeReason: 'stream_failed',
    });
    expect(deriveOutcome(parse({ ...askBase, outcome: 'aborted' }))).toEqual({
      status: 'aborted',
      outcome: 'aborted',
      outcomeReason: null,
    });
  });

  it('derives generic outcome from status + optional reason', () => {
    expect(deriveOutcome(parse(genericBase))).toEqual({
      status: 'ok',
      outcome: 'ok',
      outcomeReason: null,
    });
    expect(
      deriveOutcome(parse({ ...genericBase, status: 'error', outcomeReason: 'extraction_low_confidence' }))
    ).toEqual({
      status: 'error',
      outcome: 'extraction_low_confidence',
      outcomeReason: 'extraction_low_confidence',
    });
    // error with no reason → outcome falls back to the status string.
    expect(deriveOutcome(parse({ ...genericBase, status: 'error' }))).toEqual({
      status: 'error',
      outcome: 'error',
      outcomeReason: null,
    });
  });
});
