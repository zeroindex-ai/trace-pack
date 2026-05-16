import type { Client } from '@libsql/client';
import { IngestEvent } from './schema';
import { authenticate } from './auth';
import { insertEvent } from './write';

// Cap raw body size to comfortably above the documented Zod schema's
// 2000-char question + envelope. Anything larger is rejected before parse.
const MAX_BODY_BYTES = 8192;

export async function handleIngest(client: Client, req: Request): Promise<Response> {
  const declared = req.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
    }
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = IngestEvent.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const auth = req.headers.get('authorization');
  if (!authenticate(parsed.data.source, auth)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    await insertEvent(client, parsed.data, raw);
  } catch (err) {
    console.error('trace-pack ingest write failed:', err);
    return Response.json({ error: 'storage_failed' }, { status: 502 });
  }

  return new Response(null, { status: 204 });
}
