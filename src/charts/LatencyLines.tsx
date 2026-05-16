'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartColors } from '@/lib/palette';
import type { DailyLatency } from '@/queries/homepage';

type Variant = 'total' | 'first_token';

export function LatencyLines({ data, variant }: { data: DailyLatency[]; variant: Variant }) {
  const keys =
    variant === 'total'
      ? (['p50_total_ms', 'p95_total_ms', 'p99_total_ms'] as const)
      : (['p50_first_token_ms', 'p95_first_token_ms', 'p99_first_token_ms'] as const);
  const colors = [chartColors.p50, chartColors.p95, chartColors.p99];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartColors.grid} vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={24} stroke={chartColors.axis} />
        <YAxis tick={{ fontSize: 11 }} unit="ms" stroke={chartColors.axis} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            stroke={colors[i]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
