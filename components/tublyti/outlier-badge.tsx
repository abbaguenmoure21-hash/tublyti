
import { getOutlierBadge } from '@/lib/scoring/outlier';
import { mgiColor } from './mgi-scale';

export interface OutlierBadgeProps {
  score: number;
  ageDays: number;
  method: 'same_age' | 'approximate';
  baseline?: number;
}

export function OutlierBadge({ score, ageDays, method, baseline }: OutlierBadgeProps) {
  const badge = getOutlierBadge(score);
  const methodLabel = method === 'same_age'
    ? `à ${ageDays} jours d'âge`
    : `approximatif (médiane actuelle)`;
  const baselineText = baseline
    ? ` (médiane : ${baseline >= 1000 ? `${(baseline / 1000).toFixed(1)}k` : Math.round(baseline)} vues)`
    : '';
  const tooltip = `${badge.label} la médiane des 10 vidéos précédentes, ${methodLabel}${baselineText}`;

  return (
    <span
      className="group relative cursor-help inline-flex items-center gap-1 text-[12px] font-semibold px-1.5 py-0.5 rounded tabular-nums text-primary-ink"
      // Scale step as a 25 % tint (themed token); text stays primary-ink (≥ 5:1 on every step, both themes).
      style={{ backgroundColor: `color-mix(in oklch, ${mgiColor(badge.color)} 25%, transparent)` }}
    >
      {badge.label}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-popover text-popover-foreground text-[11px] font-normal px-2 py-1 rounded shadow-md border border-border whitespace-nowrap z-10 max-w-xs">
        {tooltip}
      </span>
    </span>
  );
}
