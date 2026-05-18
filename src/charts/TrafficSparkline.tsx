'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartColors } from '@/lib/palette';
import type { DailyTraffic } from '@/queries/homepage';

export function TrafficSparkline({ data }: { data: DailyTraffic[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartColors.grid} vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={24} stroke={chartColors.axis} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} stroke={chartColors.axis} />
        <Tooltip />
        <Area
          type="monotone"
          dataKey="events"
          stroke={chartColors.primary}
          fill={chartColors.primary}
          fillOpacity={0.14}
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
