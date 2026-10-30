'use client';

// recharts-backed charts, loaded on demand through next/dynamic from ./channel-charts.
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const nf = new Intl.NumberFormat('fr-FR');
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

function dayLabel(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function monthLabel(m: string) {
  return new Date(`${m}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function ChartTip({ active, payload, label, kind, unit }: { active?: boolean; payload?: { value: number }[]; label?: string; kind: 'day' | 'month'; unit: 'views' | 'usd' | 'subs' }) {
  if (!active || !payload?.length || !label) return null;
  const v = payload[0].value;
  const text = unit === 'usd' ? usd.format(v) : unit === 'subs' ? `${v > 0 ? '+' : ''}${nf.format(v)} abonnés` : `${nf.format(v)} vues`;
  return (
    <div className="elev-3 rounded-xl bg-card px-3 py-2 text-[13px]">
      <p className="text-muted-foreground">{kind === 'day' ? dayLabel(label) : monthLabel(label)}</p>
      <p className="font-semibold tabular-nums">{text}</p>
    </div>
  );
}

const axis = { fontSize: 12, fill: 'var(--muted-foreground)' };

export interface DailyChartProps {
  data: { date: string; views: number; revenue: number | null; subsNet: number }[];
  metric: 'views' | 'revenue' | 'subsNet';
  label: string;
}

/** Une seule série par graphique : jamais deux échelles sur le même axe. */
export function DailyChart({ data, metric, label }: DailyChartProps) {
  const rows = data.map((d) => ({ date: d.date, v: metric === 'revenue' ? d.revenue ?? 0 : d[metric] }));
  const unit = metric === 'revenue' ? 'usd' : metric === 'subsNet' ? 'subs' : 'views';
  const color = metric === 'revenue' ? 'var(--chart-2)' : metric === 'subsNet' ? 'var(--chart-5)' : 'var(--chart-1)';
  return (
    <div className="h-56 w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        {metric === 'views' ? (
          <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="fillViews" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis dataKey="date" tickFormatter={dayLabel} tick={axis} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis tickFormatter={(v) => compact.format(v)} tick={axis} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<ChartTip kind="day" unit={unit} />} cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.4 }} />
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill="url(#fillViews)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} />
          </AreaChart>
        ) : (
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis dataKey="date" tickFormatter={dayLabel} tick={axis} tickLine={false} axisLine={false} minTickGap={32} />
            <YAxis tickFormatter={(v) => (unit === 'usd' ? `${compact.format(v)} $` : compact.format(v))} tick={axis} tickLine={false} axisLine={false} width={48} />
            <Tooltip content={<ChartTip kind="day" unit={unit} />} cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }} />
            <Bar dataKey="v" fill={color} radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export interface MonthlyChartProps {
  data: { month: string; videos: number; views: number }[];
}

export function MonthlyChart({ data }: MonthlyChartProps) {
  return (
    <div className="h-52 w-full" role="img" aria-label="Vues actuelles des vidéos, par mois de publication">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
          <XAxis dataKey="month" tickFormatter={monthLabel} tick={axis} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={(v) => compact.format(v)} tick={axis} tickLine={false} axisLine={false} width={44} />
          <Tooltip content={<ChartTip kind="month" unit="views" />} cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }} />
          <Bar dataKey="views" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
