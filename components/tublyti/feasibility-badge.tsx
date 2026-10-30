import type { FeasibilityGrade } from '@/lib/scoring/feasibility';
import { FEASIBILITY_MEANING } from '@/lib/lexique';

// Neutral / primary scale only: phase colors are reserved for phases, warning is never text,
// red is reserved for errors (DESIGN.md).
export const GRADE_COLORS: Record<FeasibilityGrade, string> = {
  A: 'bg-primary-soft text-primary-ink',
  B: 'bg-primary-soft text-primary-ink',
  C: 'bg-muted text-foreground',
  D: 'bg-muted text-muted-foreground',
  E: 'bg-muted text-muted-foreground',
  F: 'bg-muted text-muted-foreground',
};

export { FEASIBILITY_MEANING };

/**
 * « Tes chances » on a topic: letter + visible short meaning (showLabel), never the letter alone
 * for assistive tech.
 */
export function FeasibilityBadge({ grade, showLabel = false }: { grade: FeasibilityGrade; showLabel?: boolean }) {
  const meaning = FEASIBILITY_MEANING[grade];
  if (showLabel) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium">
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-bold ${GRADE_COLORS[grade]}`}
          aria-hidden="true"
        >
          {grade}
        </span>
        <span className="text-muted-foreground">
          <span className="sr-only">Tes chances : {grade}, </span>
          {meaning}
        </span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${GRADE_COLORS[grade]}`}
      role="img"
      aria-label={`Tes chances : ${grade}, ${meaning.toLowerCase()}`}
      title={`Tes chances : ${grade}, ${meaning.toLowerCase()}`}
    >
      {grade}
    </span>
  );
}
