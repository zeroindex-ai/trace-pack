'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartColors } from '@/lib/palette';
import type { DailySpend } from '@/queries/homepage';

export function SpendChart({ data }: { data: DailySpend[] }) {
  // Recharts can't plot null; render absent days as 0 so the axis stays continuous.
  const rows = data.map((d) => ({ day: d.day, cost: d.cost_usd ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartColors.grid} vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={24} stroke={chartColors.axis} />
        <YAxis
          tick={{ fontSize: 11 }}
          stroke={chartColors.axis}
          width={56}
          tickFormatter={(v: number) => (v < 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(0)}`)}
        />
        <Tooltip
          formatter={(v) => [`$${Number(v ?? 0).toFixed(4)}`, 'cost']}
          labelStyle={{ fontFamily: 'JetBrains Mono, monospace' }}
        />
        <Bar dataKey="cost" fill={chartColors.primary} fillOpacity={0.8} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
