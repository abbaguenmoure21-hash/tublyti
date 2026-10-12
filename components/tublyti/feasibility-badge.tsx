import type { FeasibilityGrade } from '@/lib/scoring/feasibility';

const GRADE_COLORS: Record<FeasibilityGrade, string> = {
  A: 'bg-success/15 text-success',
  B: 'bg-phase-2/15 text-phase-2-ink',
  C: 'bg-muted text-muted-foreground',
  D: 'bg-warning/15 text-warning',
  E: 'bg-destructive/15 text-destructive',
  F: 'bg-destructive/15 text-destructive',
};

const GRADE_MEANING: Record<FeasibilityGrade, string> = {
  A: 'terrain libre',
  B: 'très jouable',
  C: 'compétition mixte',
  D: 'difficile',
  E: 'très difficile',
  F: 'hors de portée pour l’instant',
};

export function FeasibilityBadge({ grade }: { grade: FeasibilityGrade }) {
  return (
    <span
      className={`inline-flex items-center justify-center h-5 w-5 rounded text-[11px] font-bold ${GRADE_COLORS[grade]}`}
      title={`Faisabilité ${grade} : ${GRADE_MEANING[grade]} (détail dans Aide)`}
    >
      {grade}
    </span>
  );
}
