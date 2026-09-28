import { Sprout, Flame, Target, Ban } from 'lucide-react';

const PHASE_CONFIG: Record<
  number,
  { label: string; icon: typeof Sprout; classes: string }
> = {
  0: {
    label: 'Émergence',
    icon: Sprout,
    classes: 'bg-phase-0-soft text-phase-0-ink',
  },
  1: {
    label: 'Viralité courte',
    icon: Flame,
    classes: 'bg-phase-1-soft text-phase-1-ink',
  },
  2: {
    label: 'Fenêtre idéale',
    icon: Target,
    classes: 'bg-phase-2-soft text-phase-2-ink',
  },
  3: {
    label: 'Saturation',
    icon: Ban,
    classes: 'bg-phase-3-soft text-phase-3-ink',
  },
};

export function PhaseBadge({
  phase,
}: {
  phase: number | null | undefined;
}) {
  if (phase === null || phase === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const config = PHASE_CONFIG[phase];
  if (!config)
    return <span className="text-xs text-muted-foreground">?</span>;

  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${config.classes}`}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

export function phaseColor(phase: number): string {
  return `var(--phase-${phase})`;
}

export const PHASE_LABELS: Record<number, string> = {
  0: 'Émergence',
  1: 'Viralité courte',
  2: 'Fenêtre idéale',
  3: 'Saturation',
};
