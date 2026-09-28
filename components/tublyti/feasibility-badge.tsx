import type { FeasibilityGrade } from '@/lib/scoring/feasibility';

const GRADE_COLORS: Record<FeasibilityGrade, string> = {
  A: 'bg-success/15 text-success',
  B: 'bg-phase-2/15 text-phase-2-ink',
  C: 'bg-muted text-muted-foreground',
  D: 'bg-warning/15 text-warning',
  E: 'bg-destructive/15 text-destructive',
  F: 'bg-destructive/15 text-destructive',
};

export function FeasibilityBadge({ grade }: { grade: FeasibilityGrade }) {
  return (
    <span
      className={`inline-flex items-center justify-center h-5 w-5 rounded text-[11px] font-bold ${GRADE_COLORS[grade]}`}
      title={`Faisabilite : ${grade}`}
    >
      {grade}
    </span>
  );
}
