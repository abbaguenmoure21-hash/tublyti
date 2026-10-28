'use client';

// recharts retention curve, loaded on demand (next/dynamic) from ./top-videos when a row is expanded.
import { Line, LineChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const pct = (v: number, d = 0) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: d })} %`;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function RetentionTip({ active, payload, lengthS }: { active?: boolean; payload?: { payload: { at: number; watch: number } }[]; lengthS: number | null }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="elev-3 rounded-xl bg-card px-3 py-2 text-[13px]">
      <p className="text-muted-foreground">{lengthS ? `À ${clock(p.at * lengthS)}` : `À ${pct(p.at * 100)} de la vidéo`}</p>
      <p className="font-semibold tabular-nums">{pct(p.watch * 100)} des spectateurs encore là</p>
    </div>
  );
}

export interface RetentionLineChartProps {
  points: { at: number; watch: number }[];
  lengthS: number | null;
  /** Position (0-1) of the steepest drop, drawn as a dashed line; null to hide it. */
  dropAt: number | null;
}

export function RetentionLineChart({ points, lengthS, dropAt }: RetentionLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
        <XAxis
          dataKey="at"
          type="number"
          domain={[0, 1]}
          tickFormatter={(v) => (lengthS ? clock(v * lengthS) : `${Math.round(v * 100)} %`)}
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis tickFormatter={(v) => `${Math.round(v * 100)} %`} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} width={44} domain={[0, 'auto']} />
        <Tooltip content={<RetentionTip lengthS={lengthS} />} cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.4 }} />
        {dropAt !== null && <ReferenceLine x={dropAt} stroke="var(--warning)" strokeDasharray="4 4" />}
        <Line type="monotone" dataKey="watch" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
