import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/db/client';
import { OUTCOMES } from '@/ingest/schema';
import { fmtHash, fmtMs, fmtTs, fmtUsd } from '@/lib/format';
import { errorEvents, questionClusters, recentEvents, type EventRow, type ClusterRow } from '@/queries/admin';
import { listSources } from '@/queries/sources';
import { SourceSwitcher } from '@/components/SourceSwitcher';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Traces Admin · ZeroIndex' };

const DEFAULT_SOURCE = process.env.DEFAULT_SOURCE ?? 'ask-zeroindex';
const PAGE_SIZE = 500;
const ERROR_LIMIT = 100;
const CLUSTER_LIMIT = 50;

const OUTCOME_FILTERS = ['all', ...OUTCOMES] as const;
type OutcomeFilter = (typeof OUTCOME_FILTERS)[number];

function buildHref(source: string, page: number, outcome: OutcomeFilter): string {
  const params = new URLSearchParams();
  if (source !== DEFAULT_SOURCE) params.set('source', source);
  if (page > 1) params.set('page', String(page));
  if (outcome !== 'all') params.set('outcome', outcome);
  const qs = params.toString();
  return qs ? `/admin?${qs}` : '/admin';
}

// Universal across event types: the RAG-specific columns (first-token, cites)
// live on the detail page. `outcome` is colored by the bounded `status` axis
// (ok/error/aborted) — not the open-ended outcome string — so a new event
// type's reason can't spawn an unstyled `outcome-*` class.
function EventTableRow({ row }: { row: EventRow }) {
  return (
    <tr>
      <td className="num-cell">
        <Link href={`/admin/${row.id}`} className="row-link">
          #{row.id}
        </Link>
      </td>
      <td className="ts">{fmtTs(row.ts)}</td>
      <td className="num-cell">{row.event}</td>
      <td>
        <span className={`outcome-tag outcome-${row.status}`}>{row.outcome}</span>
      </td>
      <td className="num-cell">{fmtMs(row.total_ms)}</td>
      <td className="num-cell">{fmtUsd(row.cost_usd)}</td>
      <td className="question">{row.question ?? row.outcome_reason ?? '—'}</td>
    </tr>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; page?: string; outcome?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const outcome = (OUTCOME_FILTERS as readonly string[]).includes(sp.outcome ?? '')
    ? (sp.outcome as OutcomeFilter)
    : 'all';
  const offset = (pageNum - 1) * PAGE_SIZE;

  const client = db();
  const sources = await listSources(client);
  const source = sp.source && sources.includes(sp.source) ? sp.source : DEFAULT_SOURCE;
  const [recent, errs, clusters] = await Promise.all([
    recentEvents(client, source, { limit: PAGE_SIZE, offset, outcome }),
    errorEvents(client, source, ERROR_LIMIT),
    questionClusters(client, source, 30, CLUSTER_LIMIT),
  ]);
  const totalPages = Math.max(1, Math.ceil(recent.total / PAGE_SIZE));
  const rangeStart = recent.total === 0 ? 0 : offset + 1;
  const rangeEnd = offset + recent.rows.length;
  // Clusters group by dedup_hash; only meaningful for sources that send a
  // question (ask). Non-ask sources produce singletons with no sample text.
  const hasClusters = clusters.some((c) => c.sample_question.trim() !== '');

  return (
    <>
      <section className="pt-10 pb-6">
        <div className="label mb-3">Admin • Traces</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Events</h1>
        {sources.length > 1 && (
          <div className="mt-4">
            <SourceSwitcher sources={sources} current={source} hrefFor={(s) => buildHref(s, 1, 'all')} />
          </div>
        )}
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
              <Link key={o} href={buildHref(source, 1, o)}>
                {o}
              </Link>
            )
          )}
        </div>

        <div className="card">
          {recent.rows.length === 0 ? (
            <div className="empty-state">No events match this filter.</div>
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <colgroup>
                  <col style={{ width: '64px' }} />
                  <col style={{ width: '150px' }} />
                  <col style={{ width: '96px' }} />
                  <col style={{ width: '132px' }} />
                  <col style={{ width: '84px' }} />
                  <col style={{ width: '90px' }} />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Timestamp</th>
                    <th>Event</th>
                    <th>Outcome</th>
                    <th>Total</th>
                    <th>Cost</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.rows.map((row) => (
                    <EventTableRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {recent.total > PAGE_SIZE && (
          <div className="pagination">
            {pageNum > 1 ? (
              <Link href={buildHref(source, pageNum - 1, outcome)}>
                ← Previous {PAGE_SIZE.toLocaleString()}
              </Link>
            ) : (
              <span className="disabled">← Previous {PAGE_SIZE.toLocaleString()}</span>
            )}
            <span>
              {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {recent.total.toLocaleString()}
            </span>
            {pageNum < totalPages ? (
              <Link href={buildHref(source, pageNum + 1, outcome)}>Next {PAGE_SIZE.toLocaleString()} →</Link>
            ) : (
              <span className="disabled">Next {PAGE_SIZE.toLocaleString()} →</span>
            )}
          </div>
        )}
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
            <div className="table-scroll table-scroll-min">
              <table className="admin-table">
                <colgroup>
                  <col style={{ width: '64px' }} />
                  <col style={{ width: '150px' }} />
                  <col style={{ width: '132px' }} />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Timestamp</th>
                    <th>Outcome</th>
                    <th>Error</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {errs.map((row) => (
                    <tr key={row.id}>
                      <td className="num-cell">
                        <Link href={`/admin/${row.id}`} className="row-link">
                          #{row.id}
                        </Link>
                      </td>
                      <td className="ts">{fmtTs(row.ts)}</td>
                      <td>
                        <span className={`outcome-tag outcome-${row.status}`}>{row.outcome}</span>
                      </td>
                      <td className="question">{row.error_message ?? '—'}</td>
                      <td className="question">{row.question ?? row.outcome_reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          {!hasClusters ? (
            <div className="empty-state">No repeated questions in the last 30 days.</div>
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <colgroup>
                  <col style={{ width: '72px' }} />
                  <col style={{ width: '120px' }} />
                  <col style={{ width: '150px' }} />
                  <col />
                </colgroup>
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
            </div>
          )}
        </div>
      </section>
    </>
  );
}
