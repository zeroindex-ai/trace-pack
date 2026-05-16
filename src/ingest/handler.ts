import type { Client } from '@libsql/client';
import { IngestEvent } from './schema';
import { authenticate } from './auth';
import { insertEvent } from './write';

export async function handleIngest(client: Client, req: Request): Promise<Response> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
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
