import type { Client, Row } from '@libsql/client';

export type EventRow = {
  id: number;
  source: string;
  ts: string;
  model: string | null;
  question: string | null;
  outcome: string;
  citation_count: number | null;
  retrieval_ms: number | null;
  first_token_ms: number | null;
  total_ms: number | null;
  error_message: string | null;
};

export type EventDetail = EventRow & {
  question_hash: string;
  retrieved_ids: string | null;
  raw_json: string;
};

export type ClusterRow = {
  question_hash: string;
  count: number;
  most_recent_ts: string;
  sample_question: string;
};

export type RecentEventsResult = {
  rows: EventRow[];
  total: number;
};

export type Neighbors = {
  prev: { id: number; ts: string } | null;
  next: { id: number; ts: string } | null;
};

const SELECT_COLUMNS = `
  id, source, ts, model, question, outcome,
  citation_count, retrieval_ms, first_token_ms, total_ms, error_message
`;

export async function recentEvents(
  client: Client,
  source: string,
  opts: { limit: number; offset: number; outcome?: string }
): Promise<RecentEventsResult> {
  const where = ['source = ?'];
  const whereArgs: (string | number)[] = [source];
  if (opts.outcome && opts.outcome !== 'all') {
    where.push('outcome = ?');
    whereArgs.push(opts.outcome);
  }

  const totalRes = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM events WHERE ${where.join(' AND ')}`,
    args: whereArgs,
  });
  const total = Number(totalRes.rows[0]?.n ?? 0);

  const res = await client.execute({
    sql: `SELECT ${SELECT_COLUMNS} FROM events WHERE ${where.join(' AND ')}
          ORDER BY ts DESC LIMIT ? OFFSET ?`,
    args: [...whereArgs, opts.limit, opts.offset],
  });

  return { rows: res.rows.map(rowToEvent), total };
}

export async function errorEvents(client: Client, source: string, limit: number): Promise<EventRow[]> {
  const res = await client.execute({
    sql: `SELECT ${SELECT_COLUMNS} FROM events
          WHERE source = ? AND outcome != 'ok'
          ORDER BY ts DESC LIMIT ?`,
    args: [source, limit],
  });
  return res.rows.map(rowToEvent);
}

export async function questionClusters(
  client: Client,
  source: string,
  days: number,
  limit: number,
  now: Date = new Date()
): Promise<ClusterRow[]> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  const startIso = start.toISOString();

  const res = await client.execute({
    sql: `SELECT question_hash,
                 COUNT(*) AS count,
                 MAX(ts) AS most_recent_ts,
                 question AS sample_question
          FROM events
          WHERE source = ? AND ts >= ?
          GROUP BY question_hash
          ORDER BY count DESC, most_recent_ts DESC
          LIMIT ?`,
    args: [source, startIso, limit],
  });

  return res.rows.map((r) => ({
    question_hash: String(r.question_hash),
    count: Number(r.count),
    most_recent_ts: String(r.most_recent_ts),
    sample_question: r.sample_question == null ? '' : String(r.sample_question),
  }));
}

export async function eventById(client: Client, id: number): Promise<EventDetail | null> {
  const res = await client.execute({
    sql: `SELECT * FROM events WHERE id = ?`,
    args: [id],
  });
  const [r] = res.rows;
  if (!r) return null;
  return {
    ...rowToEvent(r),
    question_hash: String(r.question_hash),
    retrieved_ids: r.retrieved_ids == null ? null : String(r.retrieved_ids),
    raw_json: String(r.raw_json),
  };
}

export async function neighbors(client: Client, source: string, ts: string): Promise<Neighbors> {
  const [prevRes, nextRes] = await Promise.all([
    client.execute({
      sql: 'SELECT id, ts FROM events WHERE source = ? AND ts < ? ORDER BY ts DESC LIMIT 1',
      args: [source, ts],
    }),
    client.execute({
      sql: 'SELECT id, ts FROM events WHERE source = ? AND ts > ? ORDER BY ts ASC LIMIT 1',
      args: [source, ts],
    }),
  ]);

  const prevRow = prevRes.rows[0];
  const nextRow = nextRes.rows[0];
  return {
    prev: prevRow ? { id: Number(prevRow.id), ts: String(prevRow.ts) } : null,
    next: nextRow ? { id: Number(nextRow.id), ts: String(nextRow.ts) } : null,
  };
}

function rowToEvent(r: Row): EventRow {
  return {
    id: Number(r.id),
    source: String(r.source),
    ts: String(r.ts),
    model: r.model == null ? null : String(r.model),
    question: r.question == null ? null : String(r.question),
    outcome: String(r.outcome),
    citation_count: r.citation_count == null ? null : Number(r.citation_count),
    retrieval_ms: r.retrieval_ms == null ? null : Number(r.retrieval_ms),
    first_token_ms: r.first_token_ms == null ? null : Number(r.first_token_ms),
    total_ms: r.total_ms == null ? null : Number(r.total_ms),
    error_message: r.error_message == null ? null : String(r.error_message),
  };
}
