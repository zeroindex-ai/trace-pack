import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from '../db/migrate';
import { handleIngest } from './handler';

const VALID_TOKEN = 'test-bearer-token';

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    source: 'ask-zeroindex',
    event: 'ask',
    ts: '2026-05-15T12:34:56.789Z',
    model: 'claude-sonnet-4-6',
    question: 'What services does ZeroIndex offer?',
    outcome: 'ok',
    retrievedIds: [3, 4, 5],
    citationCount: 2,
    retrievalMs: 142,
    firstTokenMs: 612,
    totalMs: 2104,
    errorMessage: null,
    ...overrides,
  };
}

function ingestRequest(body: unknown, opts: { auth?: string | null; rawBody?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.auth !== null && opts.auth !== undefined) {
    headers.authorization = opts.auth;
  }
  return new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers,
    body: opts.rawBody ?? JSON.stringify(body),
  });
}

describe('handleIngest', () => {
  let client: Client;
  const originalEnv = process.env.SOURCE_TOKEN_ASK_ZEROINDEX;

  beforeEach(async () => {
    client = createClient({ url: ':memory:' });
    await migrate(client);
    process.env.SOURCE_TOKEN_ASK_ZEROINDEX = VALID_TOKEN;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SOURCE_TOKEN_ASK_ZEROINDEX;
    else process.env.SOURCE_TOKEN_ASK_ZEROINDEX = originalEnv;
  });

  it('204s on a valid authenticated event and persists a row', async () => {
    const res = await handleIngest(client, ingestRequest(validEvent(), { auth: `Bearer ${VALID_TOKEN}` }));
    expect(res.status).toBe(204);

    const rows = await client.execute('SELECT * FROM events');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.source).toBe('ask-zeroindex');
    expect(rows.rows[0]?.outcome).toBe('ok');
    expect(rows.rows[0]?.question_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('400s on non-JSON body', async () => {
    const res = await handleIngest(
      client,
      ingestRequest(null, { auth: `Bearer ${VALID_TOKEN}`, rawBody: 'not json{' })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  it('400s on schema violation (missing required field)', async () => {
    const bad = validEvent();
    // @ts-expect-error — intentional schema violation
    delete bad.outcome;
    const res = await handleIngest(client, ingestRequest(bad, { auth: `Bearer ${VALID_TOKEN}` }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_body');
  });

  it('400s on out-of-range value (bad outcome enum)', async () => {
    const res = await handleIngest(
      client,
      ingestRequest(validEvent({ outcome: 'something_else' }), { auth: `Bearer ${VALID_TOKEN}` })
    );
    expect(res.status).toBe(400);
  });

  it('401s when authorization header is missing', async () => {
    const res = await handleIngest(client, ingestRequest(validEvent(), { auth: null }));
    expect(res.status).toBe(401);
  });

  it('401s on wrong bearer token', async () => {
    const res = await handleIngest(
      client,
      ingestRequest(validEvent(), { auth: 'Bearer wrong-token' })
    );
    expect(res.status).toBe(401);
  });

  it('401s on unknown source (no env token configured)', async () => {
    const res = await handleIngest(
      client,
      ingestRequest(validEvent({ source: 'never-heard-of-this' }), {
        auth: `Bearer ${VALID_TOKEN}`,
      })
    );
    expect(res.status).toBe(401);
  });

  it('is idempotent — the same event POSTed twice yields one row', async () => {
    const event = validEvent();
    const res1 = await handleIngest(client, ingestRequest(event, { auth: `Bearer ${VALID_TOKEN}` }));
    const res2 = await handleIngest(client, ingestRequest(event, { auth: `Bearer ${VALID_TOKEN}` }));
    expect(res1.status).toBe(204);
    expect(res2.status).toBe(204);
    const rows = await client.execute('SELECT COUNT(*) AS n FROM events');
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });

  it('413s when content-length header declares a body over the cap', async () => {
    // Mock a Request whose content-length header reports an over-cap size,
    // regardless of the actual body. Real fetch clients can send this when
    // streaming or with manually-set headers.
    const req = {
      headers: new Headers({
        'content-type': 'application/json',
        authorization: `Bearer ${VALID_TOKEN}`,
        'content-length': '9000',
      }),
      text: async () => JSON.stringify(validEvent()),
    } as unknown as Request;
    const res = await handleIngest(client, req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe('payload_too_large');
  });

  it('413s when the actual body exceeds the cap (regardless of header)', async () => {
    // Build a body larger than 8192 bytes by inflating the question field.
    const huge = validEvent({ question: 'x'.repeat(9000) });
    const res = await handleIngest(
      client,
      ingestRequest(huge, { auth: `Bearer ${VALID_TOKEN}` })
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe('payload_too_large');
  });

  it('stores unknown fields in raw_json via passthrough', async () => {
    const extended = { ...validEvent(), inputTokens: 1234, outputTokens: 567 };
    const res = await handleIngest(
      client,
      ingestRequest(extended, { auth: `Bearer ${VALID_TOKEN}` })
    );
    expect(res.status).toBe(204);

    const rows = await client.execute('SELECT raw_json FROM events');
    const raw = JSON.parse(String(rows.rows[0]?.raw_json));
    expect(raw.inputTokens).toBe(1234);
    expect(raw.outputTokens).toBe(567);
  });
});
