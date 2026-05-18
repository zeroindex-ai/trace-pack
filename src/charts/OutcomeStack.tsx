'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartColors } from '@/lib/palette';
import type { DailyOutcomes } from '@/queries/homepage';

export function OutcomeStack({ data }: { data: DailyOutcomes[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartColors.grid} vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={24} stroke={chartColors.axis} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} stroke={chartColors.axis} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="ok" stackId="a" fill={chartColors.ok} isAnimationActive={false} />
        <Bar
          dataKey="retrieval_failed"
          stackId="a"
          fill={chartColors.retrievalFailed}
          isAnimationActive={false}
        />
        <Bar dataKey="stream_failed" stackId="a" fill={chartColors.streamFailed} isAnimationActive={false} />
        <Bar dataKey="aborted" stackId="a" fill={chartColors.aborted} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
