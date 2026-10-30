/** Plain-French text alternative for multi-series line charts (screen readers). */

export interface SeriesPoint {
  date: string;
  value: number;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}

/** One sentence per series: trend from first to last point, last value and peak date. */
export function summarizeSeries(series: Record<string, SeriesPoint[]>, labels: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(series)) {
    const points = [...raw].sort((a, b) => a.date.localeCompare(b.date));
    if (points.length === 0) continue;
    const first = points[0];
    const last = points[points.length - 1];
    const peak = points.reduce((m, p) => (p.value > m.value ? p : m), first);
    const name = labels[key] ?? key;
    let trend = 'stable';
    if (first.value > 0) {
      const pct = Math.round(((last.value - first.value) / first.value) * 100);
      if (pct > 0) trend = `en hausse de ${pct} %`;
      else if (pct < 0) trend = `en baisse de ${Math.abs(pct)} %`;
    } else if (last.value > 0) {
      trend = 'en hausse';
    }
    parts.push(
      `${name} : ${trend} du ${fmtDate(first.date)} au ${fmtDate(last.date)}, dernière valeur ${fmtNum(last.value)}, pic de ${fmtNum(peak.value)} le ${fmtDate(peak.date)}.`,
    );
  }
  return parts.join(' ');
}
