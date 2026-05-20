import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db/client';
import { fmtMs, fmtTs } from '@/lib/format';
import { eventById, neighbors } from '@/queries/admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Event · Traces Admin · ZeroIndex' };

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number.parseInt(id, 10);
  if (!Number.isFinite(eventId)) notFound();

  const client = db();
  const event = await eventById(client, eventId);
  if (!event) notFound();
  const neigh = await neighbors(client, event.source, event.ts);

  return (
    <>
      <section className="pt-10 pb-6">
        <div className="label mb-3">
          <Link href="/admin" className="subtle">
            ← Admin
          </Link>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Event <span className="muted-2">#{event.id}</span>
        </h1>
        <p className="mt-4 muted text-base leading-relaxed event-meta">
          <span className={`outcome-tag outcome-${event.outcome}`}>{event.outcome}</span>
          <span className="meta-sep">·</span>
          <code className="chip">{event.source}</code>
          <span className="meta-sep">·</span>
          {fmtTs(event.ts)}
        </p>

        <div className="pagination mt-6">
          {neigh.prev ? (
            <Link href={`/admin/${neigh.prev.id}`}>← #{neigh.prev.id}</Link>
          ) : (
            <span className="disabled">← prev</span>
          )}
          {neigh.next ? (
            <Link href={`/admin/${neigh.next.id}`}>#{neigh.next.id} →</Link>
          ) : (
            <span className="disabled">next →</span>
          )}
        </div>
      </section>

      <section className="pt-2 pb-8">
        <div className="label mb-4">00 / Typed fields</div>
        <div className="card">
          <dl className="kv-list">
            <dt>id</dt> <dd className="mono">{event.id}</dd>
            <dt>source</dt> <dd className="mono">{event.source}</dd>
            <dt>ts</dt> <dd className="mono">{event.ts}</dd>
            <dt>model</dt> <dd className="mono">{event.model ?? '—'}</dd>
            <dt>outcome</dt>{' '}
            <dd>
              <span className={`outcome-tag outcome-${event.outcome}`}>{event.outcome}</span>
            </dd>
            <dt>question_hash</dt> <dd className="mono">{event.question_hash}</dd>
            <dt>question</dt> <dd>{event.question ?? '—'}</dd>
            <dt>retrieved_ids</dt> <dd className="mono">{event.retrieved_ids ?? '—'}</dd>
            <dt>citation_count</dt> <dd className="mono">{event.citation_count ?? '—'}</dd>
            <dt>retrieval_ms</dt> <dd className="mono">{fmtMs(event.retrieval_ms)}</dd>
            <dt>first_token_ms</dt> <dd className="mono">{fmtMs(event.first_token_ms)}</dd>
            <dt>total_ms</dt> <dd className="mono">{fmtMs(event.total_ms)}</dd>
            <dt>error_message</dt> <dd>{event.error_message ?? '—'}</dd>
          </dl>
        </div>
      </section>

      <section className="pt-2 pb-24">
        <div className="label mb-4">01 / Raw payload</div>
        <div className="card">
          <pre className="raw-json">{prettyJson(event.raw_json)}</pre>
        </div>
      </section>
    </>
  );
}
