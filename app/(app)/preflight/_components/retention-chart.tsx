'use client';

import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Predicted-retention line chart. Lives in its own module so recharts loads only after a result (next/dynamic). */
export function RetentionChart({ data, durationS }: { data: { at_pct: number; watch: number }[]; durationS: number | null | undefined }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
        <XAxis dataKey="at_pct" tickFormatter={(x: number) => (durationS ? clock((x / 100) * durationS) : `${x} %`)} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 1]} tickFormatter={(x: number) => `${Math.round(x * 100)} %`} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} width={44} />
        <Tooltip formatter={(x) => [`${Math.round(Number(x) * 100)} %`, 'Encore là']} labelFormatter={(x) => (durationS ? `À ${clock((Number(x) / 100) * durationS)}` : `À ${x} %`)} />
        <Line type="monotone" dataKey="watch" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
