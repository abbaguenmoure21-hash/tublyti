'use client';

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { PHASE_LABELS, phaseColor } from '@/components/tublyti/phase-badge';

interface ScatterPoint {
  x: number;
  y: number;
  z: number;
  phase: number;
  label: string;
  mgi: number;
  id: string;
}

export function OpportunityChart({ data }: { data: ScatterPoint[] }) {
  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={350}>
      <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          type="number"
          dataKey="x"
          name="Vidéos de qualité existantes"
          label={{
            value: 'Vidéos de qualité existantes',
            position: 'insideBottom',
            offset: -15,
            style: { fontSize: 12, fill: 'var(--muted-foreground)' },
          }}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Demande"
          label={{
            value: 'Demande (D)',
            angle: -90,
            position: 'insideLeft',
            style: { fontSize: 12, fill: 'var(--muted-foreground)' },
          }}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
        />
        <Tooltip
          content={({ payload }) => {
            if (!payload || payload.length === 0) return null;
            const d = payload[0].payload as ScatterPoint;
            return (
              <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
                <p className="font-medium text-popover-foreground">{d.label}</p>
                <p className="text-muted-foreground tabular-nums">Potentiel : {Math.round(d.mgi)}</p>
                <p className="text-muted-foreground tabular-nums">Demande : {d.y.toFixed(0)}</p>
                <p className="text-muted-foreground tabular-nums">Offre : {d.x.toFixed(1)}</p>
                <p className="text-muted-foreground">Phase : {PHASE_LABELS[d.phase] ?? '?'}</p>
              </div>
            );
          }}
        />
        <Scatter data={data}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={phaseColor(entry.phase)}
              fillOpacity={0.7}
              r={Math.sqrt(entry.z)}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
