'use client';

import { getMgiBand, type ConfidenceResult } from '@/lib/scoring/mgi';
import { InfoHint } from '@/components/tublyti/info-hint';

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'Élevée',
  medium: 'Moyenne',
  low: 'Faible',
};

const CONFIDENCE_DOTS: Record<string, string> = {
  high: 'bg-[var(--success)]',
  medium: 'bg-[var(--warning)]',
  low: 'bg-[var(--destructive)]',
};

function formatFreshness(scoredAt: string | null | undefined): string | null {
  if (!scoredAt) return null;
  const diff = Date.now() - new Date(scoredAt).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'mis \u00e0 jour \u00e0 l\u2019instant';
  if (hours < 24) return `mis \u00e0 jour il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `mis \u00e0 jour il y a ${days} j`;
}

export function MgiScore({
  value,
  confidence,
  scoredAt,
  compact = false,
}: {
  value: number | null | undefined;
  confidence?: ConfidenceResult | null;
  scoredAt?: string | null;
  compact?: boolean;
}) {
  if (value === null || value === undefined) {
    return (
      <span className="text-sm text-muted-foreground tabular-nums">\u2014</span>
    );
  }

  const rounded = Math.round(value);
  const band = getMgiBand(rounded);
  const freshness = formatFreshness(scoredAt);
  const isStale = scoredAt
    ? Date.now() - new Date(scoredAt).getTime() > 36 * 3_600_000
    : false;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums min-w-[2.5rem] text-right">
          {rounded}
        </span>
        <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-200"
            style={{
              width: `${Math.min(Math.max(rounded, 0), 100)}%`,
              backgroundColor: band.color,
            }}
          />
        </div>
        <span className="text-[11px] text-muted-foreground">{band.label}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums min-w-[2.5rem] text-right">
          {rounded}
        </span>
        <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-200"
            style={{
              width: `${Math.min(Math.max(rounded, 0), 100)}%`,
              backgroundColor: band.color,
            }}
          />
        </div>
        <span
          className="text-[11px] font-medium px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: band.color + '33',
            color: band.color === '#e2e6ff' || band.color === '#b7c0f8' ? '#424882' : band.color,
          }}
        >
          {band.label}
        </span>
      </div>

      {(confidence || freshness) && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground ml-[2.5rem] pl-2">
          {confidence && (
            <InfoHint hint={confidence.reason} className="flex items-center gap-1">
              <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${CONFIDENCE_DOTS[confidence.level]}`} />
              {CONFIDENCE_LABELS[confidence.level]}
            </InfoHint>
          )}
          {confidence && freshness && <span className="text-border">\u00b7</span>}
          {freshness && (
            <span className={isStale ? 'text-[var(--warning)]' : ''}>
              {freshness}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
