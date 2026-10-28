
interface DataPoint {
  date: string;
  value: number;
}

interface SignalChartProps {
  series: Record<string, DataPoint[]>;
}

const COLORS: Record<string, string> = {
  trends: 'var(--chart-1)',
  yt_views: 'var(--chart-2)',
  hn: 'var(--chart-3)',
  stackexchange: 'var(--chart-4)',
};

const LABELS: Record<string, string> = {
  trends: 'Google Trends',
  yt_views: 'Vues YouTube',
  hn: 'Hacker News',
  stackexchange: 'Stack Exchange',
};

const W = 600;
const H = 200;
const PAD = 40;

export function SignalChart({ series }: SignalChartProps) {
  const allSources = Object.keys(series).filter(
    (s) => series[s].length > 0,
  );

  if (allSources.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Aucune donnée de signal pour ce sujet.
      </p>
    );
  }

  // Collect all dates across all series
  const allDates = [
    ...new Set(allSources.flatMap((s) => series[s].map((p) => p.date))),
  ].sort();

  if (allDates.length === 0) return null;

  const minDate = new Date(allDates[0]).getTime();
  const maxDate = new Date(allDates[allDates.length - 1]).getTime();
  const dateRange = maxDate - minDate || 1;

  function toX(date: string): number {
    return (
      PAD +
      ((new Date(date).getTime() - minDate) / dateRange) * (W - PAD * 2)
    );
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full max-w-2xl">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = PAD + (1 - frac) * (H - PAD * 2);
          return (
            <line
              key={frac}
              x1={PAD}
              y1={y}
              x2={W - PAD}
              y2={y}
              stroke="var(--border)"
              strokeWidth={0.5}
            />
          );
        })}

        {/* Each series */}
        {allSources.map((source) => {
          const points = series[source];
          if (points.length === 0) return null;

          // Normalize each series to 0-1 for comparison
          const values = points.map((p) => p.value);
          const max = Math.max(...values) || 1;

          const pathData = points
            .map((p, i) => {
              const x = toX(p.date);
              const y = PAD + (1 - p.value / max) * (H - PAD * 2);
              return `${i === 0 ? 'M' : 'L'}${x},${y}`;
            })
            .join(' ');

          return (
            <path
              key={source}
              d={pathData}
              fill="none"
              stroke={COLORS[source] ?? 'var(--muted-foreground)'}
              strokeWidth={2}
              opacity={0.8}
            />
          );
        })}

        {/* X axis labels */}
        {allDates
          .filter((_, i) => i % Math.max(1, Math.floor(allDates.length / 5)) === 0)
          .map((date) => (
            <text
              key={date}
              x={toX(date)}
              y={H + 5}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {date.slice(5)}
            </text>
          ))}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-xs">
        {allSources.map((source) => (
          <div key={source} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-0.5 rounded"
              style={{ backgroundColor: COLORS[source] ?? 'var(--muted-foreground)' }}
            />
            <span className="text-muted-foreground">
              {LABELS[source] ?? source} ({series[source].length} pts)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
