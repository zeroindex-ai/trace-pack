'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartColors } from '@/lib/palette';
import type { CitationBucket } from '@/queries/homepage';

export function CitationHistogram({ data }: { data: CitationBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartColors.grid} vertical={false} />
        <XAxis dataKey="count" tick={{ fontSize: 11 }} stroke={chartColors.axis} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} stroke={chartColors.axis} />
        <Tooltip />
        <Bar dataKey="frequency" fill={chartColors.primary} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
