import type { FeasibilityGrade } from '@/lib/scoring/feasibility';

/** Couleurs des notes de faisabilité. Jamais de couleur de phase (réservées aux phases). Texte ≥ 4,5:1. */
export const GRADE_COLORS: Record<FeasibilityGrade, string> = {
  A: 'bg-success-soft text-success-ink',
  B: 'bg-primary-soft text-primary-ink',
  C: 'bg-muted text-muted-foreground',
  D: 'bg-warning-soft text-warning-ink',
  E: 'bg-destructive/10 text-destructive',
  F: 'bg-destructive/10 text-destructive',
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
