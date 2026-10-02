'use client';

import { motion } from 'framer-motion';

const PHASE_CONFIG = {
  0: {
    label: 'Émergence',
    dotClass: 'bg-phase-0',
    textClass: 'text-phase-0-ink',
    borderClass: 'border-phase-0/30',
    ringClass: 'bg-phase-0',
  },
  1: {
    label: 'Viralité courte',
    dotClass: 'bg-phase-1',
    textClass: 'text-phase-1-ink',
    borderClass: 'border-phase-1/30',
    ringClass: 'bg-phase-1',
  },
  2: {
    label: 'Fenêtre dorée',
    dotClass: 'bg-phase-2',
    textClass: 'text-phase-2-ink',
    borderClass: 'border-phase-2/30',
    ringClass: 'bg-phase-2',
  },
  3: {
    label: 'Saturé',
    dotClass: 'bg-phase-3',
    textClass: 'text-phase-3-ink',
    borderClass: 'border-phase-3/30',
    ringClass: 'bg-phase-3',
  },
} as const;

export const PHASE_LABELS: Record<number, string> = {
  0: 'Émergence',
  1: 'Viralité courte',
  2: 'Fenêtre dorée',
  3: 'Saturation',
};

interface PhaseBadgeAnimatedProps {
  phase: number | null | undefined;
  /** Show a compact version without label */
  compact?: boolean;
}

/**
 * PhaseBadge v2 — Animated badge with soft pulsing ring for Phase 2 (golden window).
 * Glass backdrop with colored dot indicator, per the spec.
 */
export function PhaseBadgeAnimated({ phase, compact = false }: PhaseBadgeAnimatedProps) {
  if (phase === null || phase === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const config = PHASE_CONFIG[phase as keyof typeof PHASE_CONFIG];
  if (!config) {
    return <span className="text-xs text-muted-foreground">?</span>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 15, mass: 0.6 }}
      className={`
        inline-flex items-center gap-2 px-3 py-1
        rounded-full border
        backdrop-blur-md bg-white/[0.04]
        ${config.borderClass}
      `}
    >
      {/* Pulsing dot */}
      <span className="relative flex h-2 w-2">
        {phase === 2 && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${config.ringClass}`}
          />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dotClass}`} />
      </span>

      {!compact && (
        <span className={`text-xs font-semibold tracking-wide uppercase ${config.textClass}`}>
          {config.label}
        </span>
      )}
    </motion.div>
  );
}
