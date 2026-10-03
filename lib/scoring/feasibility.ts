/**
 * Feasibility Score (P33)
 *
 * Compares the owner channel's stats (subscribers, median views) to the
 * channels that published qualified videos for a given topic.
 *
 * Grades A–F:
 *   A — Most qualified videos come from channels your size or smaller
 *   B — Significant portion from smaller channels
 *   C — Mixed competition
 *   D — Most videos from bigger channels
 *   E — Nearly all from much bigger channels
 *   F — Extreme mismatch
 *
 * Numeric weight used for sorting: A=1.0, B=0.85, C=0.7, D=0.5, E=0.3, F=0.15
 */

export type FeasibilityGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface FeasibilityResult {
  grade: FeasibilityGrade;
  reason: string;
  weight: number;
}

const GRADE_WEIGHTS: Record<FeasibilityGrade, number> = {
  A: 1.0,
  B: 0.85,
  C: 0.7,
  D: 0.5,
  E: 0.3,
  F: 0.15,
};

export function gradeWeight(grade: FeasibilityGrade): number {
  return GRADE_WEIGHTS[grade] ?? 0.5;
}

/**
 * Compute feasibility grade for a topic.
 *
 * @param ownerSubs - subscriber count of the owner's channel for this niche
 * @param competitorSubs - subscriber counts of channels that published qualified videos
 * @param qualifiedCount - number of qualified videos for this topic (in last 180 days)
 */
export function computeFeasibility(
  ownerSubs: number | null,
  competitorSubs: number[],
  qualifiedCount: number,
): FeasibilityResult {
  // No owner channel configured → skip
  if (ownerSubs == null || ownerSubs <= 0) {
    return { grade: 'C', reason: 'Aucune chaîne propriétaire configurée pour cette niche.', weight: 0.7 };
  }

  // No qualified competition → very feasible
  if (qualifiedCount === 0 || competitorSubs.length === 0) {
    return { grade: 'A', reason: 'Aucune bonne vidéo concurrente : le terrain est libre.', weight: 1.0 };
  }

  // Count how many qualified videos come from channels ≤ owner's size
  const smallerOrEqual = competitorSubs.filter((s) => s <= ownerSubs).length;
  const ratio = smallerOrEqual / competitorSubs.length;

  // Median competitor subscriber count
  const sorted = [...competitorSubs].sort((a, b) => a - b);
  const medianCompSubs = sorted[Math.floor(sorted.length / 2)];
  const subsRatio = medianCompSubs > 0 ? ownerSubs / medianCompSubs : 1;

  // Grade determination
  let grade: FeasibilityGrade;
  let reason: string;

  if (ratio >= 0.6 || (subsRatio >= 1.5 && ratio >= 0.3)) {
    grade = 'A';
    reason = `${smallerOrEqual} des ${competitorSubs.length} bonnes vidéos viennent de chaînes plus petites ou de ta taille.`;
  } else if (ratio >= 0.4 || subsRatio >= 1.0) {
    grade = 'B';
    reason = `${smallerOrEqual} des ${competitorSubs.length} vidéos qui marchent viennent de chaînes plus petites que la tienne.`;
  } else if (ratio >= 0.2 || subsRatio >= 0.5) {
    grade = 'C';
    reason = `Compétition mixte : ${smallerOrEqual} des ${competitorSubs.length} vidéos viennent de chaînes de ta taille ou plus petites.`;
  } else if (ratio >= 0.1 || subsRatio >= 0.2) {
    grade = 'D';
    reason = `La plupart des bonnes vidéos viennent de chaînes plus grosses (médiane : ${formatSubs(medianCompSubs)} abonnés vs tes ${formatSubs(ownerSubs)}).`;
  } else if (subsRatio >= 0.05) {
    grade = 'E';
    reason = `Quasi toutes les vidéos viennent de grosses chaînes (médiane : ${formatSubs(medianCompSubs)} abonnés vs tes ${formatSubs(ownerSubs)}).`;
  } else {
    grade = 'F';
    reason = `Écart extrême : tes ${formatSubs(ownerSubs)} abonnés face à des chaînes de ${formatSubs(medianCompSubs)} abonnés en médiane.`;
  }

  return { grade, reason, weight: GRADE_WEIGHTS[grade] };
}

function formatSubs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')} k`;
  return String(n);
}
