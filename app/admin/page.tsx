import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db/client';
import { OUTCOMES } from '@/ingest/schema';
import { fmtHash, fmtMs, fmtTs } from '@/lib/format';
import { errorEvents, questionClusters, recentEvents, type EventRow, type ClusterRow } from '@/queries/admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Traces Admin · ZeroIndex' };

const SOURCE = process.env.DEFAULT_SOURCE ?? 'ask-zeroindex';
const PAGE_SIZE = 50;
const ERROR_LIMIT = 25;
const CLUSTER_LIMIT = 25;

const OUTCOME_FILTERS = ['all', ...OUTCOMES] as const;
type OutcomeFilter = (typeof OUTCOME_FILTERS)[number];

function buildHref(page: number, outcome: OutcomeFilter): string {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (outcome !== 'all') params.set('outcome', outcome);
  const qs = params.toString();
  return qs ? `/admin?${qs}` : '/admin';
}

function EventTableRow({ row }: { row: EventRow }) {
  return (
    <tr>
      <td className="ts">
        <Link href={`/admin/${row.id}`} className="row-link">
          {fmtTs(row.ts)}
        </Link>
      </td>
      <td>
        <span className={`outcome-tag outcome-${row.outcome}`}>{row.outcome}</span>
      </td>
      <td className="num-cell">{fmtMs(row.total_ms)}</td>
      <td className="num-cell">{fmtMs(row.first_token_ms)}</td>
      <td className="num-cell">{row.citation_count ?? '—'}</td>
      <td className="question">{row.question ?? '—'}</td>
    </tr>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; outcome?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const outcome = (OUTCOME_FILTERS as readonly string[]).includes(sp.outcome ?? '')
    ? (sp.outcome as OutcomeFilter)
    : 'all';
  const offset = (pageNum - 1) * PAGE_SIZE;

  const client = db();
  const [recent, errs, clusters] = await Promise.all([
    recentEvents(client, SOURCE, { limit: PAGE_SIZE, offset, outcome }),
    errorEvents(client, SOURCE, ERROR_LIMIT),
    questionClusters(client, SOURCE, 30, CLUSTER_LIMIT),
  ]);
  const totalPages = Math.max(1, Math.ceil(recent.total / PAGE_SIZE));

  return (
    <>
      <section className="pt-10 pb-6">
        <div className="label mb-3">Admin</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Events.</h1>
        <p className="mt-4 muted text-base leading-relaxed max-w-5xl">
          Per-event detail for <code className="chip">{SOURCE}</code>. Public dashboard at{' '}
          <Link href="/" className="inline-link">
            /
          </Link>{' '}
          shows aggregates only.
        </p>
      </section>

      <section className="pt-2 pb-8">
        <div className="label mb-2">00 / Recent events</div>
        <p className="muted text-sm mb-4">
          Newest first. {recent.total.toLocaleString()} total
          {outcome !== 'all' && ` matching outcome=${outcome}`}.
        </p>

        <div className="filter-strip">
          {OUTCOME_FILTERS.map((o) =>
            o === outcome ? (
              <span key={o} className="current">
                {o}
              </span>
            ) : (
              <Link key={o} href={buildHref(1, o)}>
                {o}
              </Link>
            )
          )}
        </div>

        <div className="card">
          {recent.rows.length === 0 ? (
            <div className="empty-state">No events match this filter.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Outcome</th>
                  <th>Total</th>
                  <th>First token</th>
                  <th>Cites</th>
                  <th>Question</th>
                </tr>
              </thead>
              <tbody>
                {recent.rows.map((row) => (
                  <EventTableRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="pagination">
          {pageNum > 1 ? (
            <Link href={buildHref(pageNum - 1, outcome)}>← Prev</Link>
          ) : (
            <span className="disabled">← Prev</span>
          )}
          <span>
            Page {pageNum} of {totalPages}
          </span>
          {pageNum < totalPages ? (
            <Link href={buildHref(pageNum + 1, outcome)}>Next →</Link>
          ) : (
            <span className="disabled">Next →</span>
          )}
        </div>
      </section>

      <div className="grad-divider"></div>

      <section className="pt-10 pb-8">
        <div className="label mb-2">01 / Error feed</div>
        <p className="muted text-sm mb-4">
          Last {ERROR_LIMIT} events where outcome ≠ <code className="chip">ok</code>.
        </p>
        <div className="card">
          {errs.length === 0 ? (
            <div className="empty-state">No errors. Excellent.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Outcome</th>
                  <th>Error</th>
                  <th>Question</th>
                </tr>
              </thead>
              <tbody>
                {errs.map((row) => (
                  <tr key={row.id}>
                    <td className="ts">
                      <Link href={`/admin/${row.id}`} className="row-link">
                        {fmtTs(row.ts)}
                      </Link>
                    </td>
                    <td>
                      <span className={`outcome-tag outcome-${row.outcome}`}>{row.outcome}</span>
                    </td>
                    <td className="question">{row.error_message ?? '—'}</td>
                    <td className="question">{row.question ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="grad-divider"></div>

      <section className="pt-10 pb-24">
        <div className="label mb-2">02 / Question clusters</div>
        <p className="muted text-sm mb-4">
          Same question, asked multiple times. Last 30 days. Top {CLUSTER_LIMIT}.
        </p>
        <div className="card">
          {clusters.length === 0 ? (
            <div className="empty-state">No data in the last 30 days.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Count</th>
                  <th>Hash</th>
                  <th>Most recent</th>
                  <th>Sample question</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((c: ClusterRow) => (
                  <tr key={c.question_hash}>
                    <td className="num-cell">{c.count}</td>
                    <td className="num-cell">{fmtHash(c.question_hash)}</td>
                    <td className="ts">{fmtTs(c.most_recent_ts)}</td>
                    <td className="question-wide">{c.sample_question}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
