import type { ReactNode } from 'react';
import Link from 'next/link';
import { db } from '@/db/client';
import { CitationHistogram } from '@/charts/CitationHistogram';
import { LatencyLines } from '@/charts/LatencyLines';
import { OutcomeStack } from '@/charts/OutcomeStack';
import { SpendChart } from '@/charts/SpendChart';
import { TopRetrieved } from '@/charts/TopRetrieved';
import { TrafficSparkline } from '@/charts/TrafficSparkline';
import { SourceSwitcher } from '@/components/SourceSwitcher';
import { fmtInt, fmtPct, fmtTs, fmtUsd } from '@/lib/format';
import {
  citationHistogram,
  dailyLatencies,
  dailyOutcomes,
  dailySpend,
  dailyTraffic,
  topRetrievedIds,
} from '@/queries/homepage';
import { listSources, sourceOverview, type SourceSummary } from '@/queries/sources';

export const dynamic = 'force-dynamic';

const DEFAULT_SOURCE = process.env.DEFAULT_SOURCE ?? 'ask-zeroindex';
const WINDOW_DAYS = 30;

type DashboardData = {
  traffic: Awaited<ReturnType<typeof dailyTraffic>>;
  outcomes: Awaited<ReturnType<typeof dailyOutcomes>>;
  latencies: Awaited<ReturnType<typeof dailyLatencies>>;
  spend: Awaited<ReturnType<typeof dailySpend>>;
  citations: Awaited<ReturnType<typeof citationHistogram>>;
  topIds: Awaited<ReturnType<typeof topRetrievedIds>>;
};

async function loadDashboard(client: ReturnType<typeof db>, source: string): Promise<DashboardData> {
  const [traffic, outcomes, latencies, spend, citations, topIds] = await Promise.all([
    dailyTraffic(client, source, WINDOW_DAYS),
    dailyOutcomes(client, source, WINDOW_DAYS),
    dailyLatencies(client, source, WINDOW_DAYS),
    dailySpend(client, source, WINDOW_DAYS),
    citationHistogram(client, source, WINDOW_DAYS),
    topRetrievedIds(client, source, WINDOW_DAYS, 10),
  ]);
  return { traffic, outcomes, latencies, spend, citations, topIds };
}

function ChartCard({
  num,
  title,
  subtitle,
  hasData,
  emptyMessage,
  children,
}: {
  num: string;
  title: string;
  subtitle: string;
  hasData: boolean;
  emptyMessage: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="num text-xs mb-2">{num}</div>
      <h3>{title}</h3>
      <p className="subtitle">{subtitle}</p>
      {hasData ? children : <div className="empty-state">{emptyMessage}</div>}
    </section>
  );
}

function SourceDashboard({ data }: { data: DashboardData }) {
  const hasTraffic = data.traffic.some((d) => d.events > 0);
  const hasOutcomes = data.outcomes.some((d) => d.ok + d.error + d.aborted > 0);
  const hasLatency = data.latencies.some((d) => d.p50_total_ms !== null);
  const hasFirstToken = data.latencies.some((d) => d.p50_first_token_ms !== null);
  const hasSpend = data.spend.some((d) => d.cost_usd !== null);

  return (
    <div className="grid gap-4">
      <ChartCard
        num="00 / Traffic"
        title="Requests per day"
        subtitle="Total events ingested, by day."
        hasData={hasTraffic}
        emptyMessage="No events yet."
      >
        <TrafficSparkline data={data.traffic} />
      </ChartCard>

      <ChartCard
        num="01 / Outcomes"
        title="Outcome distribution"
        subtitle="ok / error / aborted, stacked per day."
        hasData={hasOutcomes}
        emptyMessage="No events yet."
      >
        <OutcomeStack data={data.outcomes} />
      </ChartCard>

      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard
          num="02 / Latency"
          title="Total response time"
          subtitle="p50 / p95 / p99 from request to final byte."
          hasData={hasLatency}
          emptyMessage="No latency data yet."
        >
          <LatencyLines data={data.latencies} variant="total" />
        </ChartCard>

        <ChartCard
          num="03 / Spend"
          title="Cost per day"
          subtitle="Estimated USD across input, output, and cached tokens."
          hasData={hasSpend}
          emptyMessage="No cost data yet — this source isn't reporting token usage."
        >
          <SpendChart data={data.spend} />
        </ChartCard>
      </div>

      {/* RAG-only charts — rendered only when the source emits that data, so a
          non-RAG app's dashboard simply doesn't show them (design §5.3). */}
      {(hasFirstToken || data.citations.length > 0 || data.topIds.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          {hasFirstToken && (
            <ChartCard
              num="04 / Latency"
              title="First-token latency"
              subtitle="p50 / p95 / p99 from request to first streamed token."
              hasData
              emptyMessage=""
            >
              <LatencyLines data={data.latencies} variant="first_token" />
            </ChartCard>
          )}

          {data.citations.length > 0 && (
            <ChartCard
              num="05 / Citations"
              title="Citation count distribution"
              subtitle="How many sources each answer cites."
              hasData
              emptyMessage=""
            >
              <CitationHistogram data={data.citations} />
            </ChartCard>
          )}

          {data.topIds.length > 0 && (
            <ChartCard
              num="06 / Retrieval"
              title="Top retrieved chunks"
              subtitle="Which content shows up most across results."
              hasData
              emptyMessage=""
            >
              <TopRetrieved data={data.topIds} />
            </ChartCard>
          )}
        </div>
      )}
    </div>
  );
}

function OverviewTable({ rows }: { rows: SourceSummary[] }) {
  return (
    <div className="card">
      {rows.length === 0 ? (
        <div className="empty-state">No sources reporting yet.</div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <colgroup>
              <col />
              <col style={{ width: '120px' }} />
              <col style={{ width: '110px' }} />
              <col style={{ width: '130px' }} />
              <col style={{ width: '160px' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Source</th>
                <th>Events</th>
                <th>Error rate</th>
                <th>Spend</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.source}>
                  <td>
                    <Link href={`/?source=${encodeURIComponent(r.source)}`} className="row-link">
                      {r.source}
                    </Link>
                  </td>
                  <td className="num-cell">{fmtInt(r.events)}</td>
                  <td className="num-cell">{fmtPct(r.errorRate)}</td>
                  <td className="num-cell">{fmtUsd(r.costUsd)}</td>
                  <td className="ts">{fmtTs(r.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const sp = await searchParams;

  let error: string | null = null;
  let sources: string[] = [];
  let mode: 'overview' | 'source' = 'source';
  let activeSource = DEFAULT_SOURCE;
  let overview: SourceSummary[] | null = null;
  let data: DashboardData | null = null;

  try {
    const client = db();
    sources = await listSources(client);
    const requested = sp.source && sources.includes(sp.source) ? sp.source : undefined;

    if (sources.length <= 1) {
      mode = 'source';
      activeSource = sources[0] ?? DEFAULT_SOURCE;
    } else if (requested) {
      mode = 'source';
      activeSource = requested;
    } else {
      mode = 'overview';
    }

    if (mode === 'overview') {
      overview = await sourceOverview(client, WINDOW_DAYS);
    } else {
      data = await loadDashboard(client, activeSource);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : 'unknown error';
  }

  const multi = sources.length > 1;

  return (
    <>
      <section className="pt-10 pb-8">
        <div className="label mb-3">Traces</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Live observability.</h1>
        <p className="mt-4 muted text-base leading-relaxed max-w-5xl">
          {mode === 'overview' ? (
            <>Post-prod telemetry across every Claude app reporting in. </>
          ) : (
            <>
              Post-prod telemetry from <code className="chip">{activeSource}</code>, ingested as it
              happens.{' '}
            </>
          )}
          Companion to{' '}
          <a href="https://evals.zeroindex.ai" className="inline-link">
            evals.zeroindex.ai
          </a>{' '}
          — evals catch regressions before deploy; traces show what actually happens after.
        </p>
      </section>

      <section className="pt-2 pb-24">
        {multi && (
          <SourceSwitcher
            sources={sources}
            current={mode === 'overview' ? null : activeSource}
            hrefFor={(s) => `/?source=${encodeURIComponent(s)}`}
            allHref="/"
          />
        )}

        <div className="label mb-6">
          {mode === 'overview' ? `All apps · last ${WINDOW_DAYS} days` : `Last ${WINDOW_DAYS} days`}
        </div>

        {error && (
          <div className="error-state mb-6">
            <strong>Dashboard unavailable.</strong> {error}
          </div>
        )}

        {!error && mode === 'overview' && <OverviewTable rows={overview ?? []} />}
        {!error && mode === 'source' && data && <SourceDashboard data={data} />}

        <p className="muted-2 mono text-xs mt-10">Aggregates only — per-event detail is admin-gated.</p>
      </section>
    </>
  );
}
