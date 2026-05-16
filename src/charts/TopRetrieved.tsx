'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { chartColors, palette } from '@/lib/palette';
import type { RetrievedIdRow } from '@/queries/homepage';

export function TopRetrieved({ data }: { data: RetrievedIdRow[] }) {
  const display = data.map((d) => ({ chunkId: `#${d.chunkId}`, count: d.count }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, display.length * 32)}>
      <BarChart
        data={display}
        layout="vertical"
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid stroke={chartColors.grid} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} stroke={chartColors.axis} />
        <YAxis type="category" dataKey="chunkId" tick={{ fontSize: 11 }} width={64} stroke={chartColors.axis} />
        <Tooltip />
        <Bar dataKey="count" fill={palette.accent2} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
