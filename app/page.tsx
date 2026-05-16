import { db } from '@/db/client';
import { CitationHistogram } from '@/charts/CitationHistogram';
import { LatencyLines } from '@/charts/LatencyLines';
import { OutcomeStack } from '@/charts/OutcomeStack';
import { TopRetrieved } from '@/charts/TopRetrieved';
import { TrafficSparkline } from '@/charts/TrafficSparkline';
import {
  citationHistogram,
  dailyLatencies,
  dailyOutcomes,
  dailyTraffic,
  topRetrievedIds,
} from '@/queries/homepage';

export const dynamic = 'force-dynamic';

const SOURCE = process.env.DEFAULT_SOURCE ?? 'ask-zeroindex';
const WINDOW_DAYS = 30;

type DashboardData = {
  traffic: Awaited<ReturnType<typeof dailyTraffic>>;
  outcomes: Awaited<ReturnType<typeof dailyOutcomes>>;
  latencies: Awaited<ReturnType<typeof dailyLatencies>>;
  citations: Awaited<ReturnType<typeof citationHistogram>>;
  topIds: Awaited<ReturnType<typeof topRetrievedIds>>;
};

async function loadDashboard(): Promise<DashboardData> {
  const client = db();
  const [traffic, outcomes, latencies, citations, topIds] = await Promise.all([
    dailyTraffic(client, SOURCE, WINDOW_DAYS),
    dailyOutcomes(client, SOURCE, WINDOW_DAYS),
    dailyLatencies(client, SOURCE, WINDOW_DAYS),
    citationHistogram(client, SOURCE, WINDOW_DAYS),
    topRetrievedIds(client, SOURCE, WINDOW_DAYS, 10),
  ]);
  return { traffic, outcomes, latencies, citations, topIds };
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
  children: React.ReactNode;
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

export default async function HomePage() {
  let data: DashboardData | null = null;
  let error: string | null = null;
  try {
    data = await loadDashboard();
  } catch (err) {
    error = err instanceof Error ? err.message : 'unknown error';
  }

  const hasTraffic = !!data?.traffic.some((d) => d.events > 0);
  const hasOutcomes = !!data?.outcomes.some(
    (d) => d.ok + d.retrieval_failed + d.stream_failed + d.aborted > 0
  );
  const hasLatency = !!data?.latencies.some((d) => d.p50_total_ms !== null);

  return (
    <>
      <section className="pt-10 pb-8">
        <div className="label mb-3">Traces</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Live observability.
        </h1>
        <p className="mt-4 muted text-base leading-relaxed max-w-5xl">
          Post-prod telemetry from{' '}
          <code className="chip">{SOURCE}</code>, ingested as it happens. Companion to{' '}
          <a href="https://evals.zeroindex.ai" className="inline-link">
            evals.zeroindex.ai
          </a>
          {' '}— evals catch regressions before deploy; traces show what actually happens after.
        </p>
      </section>

      <div className="grad-divider"></div>

      <section className="pt-10 pb-24">
        <div className="label mb-6">Last {WINDOW_DAYS} days</div>

        {error && (
          <div className="error-state mb-6">
            <strong>Dashboard unavailable.</strong> {error}
          </div>
        )}

        {data && (
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
              subtitle="ok / retrieval_failed / stream_failed / aborted, stacked per day."
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
                num="03 / Latency"
                title="First-token latency"
                subtitle="p50 / p95 / p99 from request to first streamed token."
                hasData={hasLatency}
                emptyMessage="No latency data yet."
              >
                <LatencyLines data={data.latencies} variant="first_token" />
              </ChartCard>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <ChartCard
                num="04 / Citations"
                title="Citation count distribution"
                subtitle="How many sources each answer cites."
                hasData={data.citations.length > 0}
                emptyMessage="No citation data yet."
              >
                <CitationHistogram data={data.citations} />
              </ChartCard>

              <ChartCard
                num="05 / Retrieval"
                title="Top retrieved chunks"
                subtitle="Which content shows up most across results."
                hasData={data.topIds.length > 0}
                emptyMessage="No retrieval data yet."
              >
                <TopRetrieved data={data.topIds} />
              </ChartCard>
            </div>
          </div>
        )}

        <p className="muted-2 mono text-xs mt-10">
          Aggregates only — per-event detail is admin-gated.
        </p>
      </section>
    </>
  );
}
