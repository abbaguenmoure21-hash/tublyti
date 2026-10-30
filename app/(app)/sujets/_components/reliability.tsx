import type { Reliability } from '@/lib/sujets/queries';
import { RELIABILITY_LABELS } from '@/lib/lexique';

// One scale, one hue (LEXIQUE: « Fiabilité haute, moyenne, faible »).
const CONFIG: Record<Reliability, { label: string; dots: number; className: string }> = {
  high: { label: RELIABILITY_LABELS.high, dots: 3, className: 'text-primary-ink' },
  medium: { label: RELIABILITY_LABELS.medium, dots: 2, className: 'text-primary-ink' },
  low: { label: RELIABILITY_LABELS.low, dots: 1, className: 'text-muted-foreground' },
};

/** Indicateur de fiabilité : 3 points + libellé (jamais la couleur seule). */
export function ReliabilityMark({ value }: { value: Reliability | null }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const c = CONFIG[value];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${c.className}`}>
      <span className="flex gap-[3px]" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-[5px] w-[5px] rounded-full ${i < c.dots ? 'bg-current' : 'bg-border'}`} />
        ))}
      </span>
      {c.label}
    </span>
  );
}

/** Jauge de potentiel 0–100 (échelle séquentielle d'une seule teinte, DESIGN.md). */
/** showLabel: prefix « Potentiel » below md, where the column header is hidden. */
export function PotentialMeter({ value, showLabel = false }: { value: number | null; showLabel?: boolean }) {
  if (value == null) return <span className="text-sm text-muted-foreground">—</span>;
  // Sequential single-hue scale from the primary token (adapts to dark mode).
  const tone = value >= 80 ? 'bg-primary' : value >= 60 ? 'bg-primary/80' : value >= 40 ? 'bg-primary/60' : 'bg-primary/40';
  return (
    <span className="inline-flex items-center gap-2" aria-label={`Potentiel ${value} sur 100`}>
      {showLabel && <span className="text-xs text-muted-foreground md:hidden" aria-hidden="true">Potentiel</span>}
      <span className="block h-1.5 w-11 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={`block h-1.5 rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </span>
      <span className="w-7 text-right text-sm font-semibold tabular-nums">{value}</span>
    </span>
  );
}
