'use client';

import { getOutlierBadge } from '@/lib/scoring/outlier';
import { InfoHint } from '@/components/tublyti/info-hint';

export interface OutlierBadgeProps {
  score: number;
  ageDays: number;
  method: 'same_age' | 'approximate';
  baseline?: number;
  /** True when the badge sits inside a link (no nested interactive control). */
  insideLink?: boolean;
}

export function OutlierBadge({ score, ageDays, method, baseline, insideLink }: OutlierBadgeProps) {
  const badge = getOutlierBadge(score);
  const methodLabel = method === 'same_age'
    ? `à ${ageDays} jours d'âge`
    : `approximatif (médiane actuelle)`;
  const baselineText = baseline
    ? ` (médiane : ${baseline >= 1000 ? `${(baseline / 1000).toFixed(1)}k` : Math.round(baseline)} vues)`
    : '';
  const tooltip = `${badge.label} la médiane des 10 vidéos précédentes, ${methodLabel}${baselineText}`;

  return (
    <InfoHint
      hint={tooltip}
      insideLink={insideLink}
      bubbleClassName="left-1/2 -translate-x-1/2"
      className="inline-flex items-center gap-1 text-[12px] font-semibold px-1.5 py-0.5 rounded tabular-nums"
      style={{
        backgroundColor: badge.color + '33',
        color: badge.color === '#e2e6ff' || badge.color === '#b7c0f8' ? '#424882' : badge.color,
      }}
    >
      {badge.label}
    </InfoHint>
  );
}
