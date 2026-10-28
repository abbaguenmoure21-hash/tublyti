/**
 * Phase computation from upload slope and outlier age.
 *
 * Phase 0 — Emergence: very few uploads, topic is nascent
 * Phase 1 — Short virality: normal upload pace
 * Phase 2 — Window: accelerating uploads, young outliers
 * Phase 3 — Saturation: decelerating or high volume
 */

export interface PhaseInputs {
  /** Number of videos published in the last 4 weeks */
  uploadsRecent4w: number;
  /** Number of videos published in weeks 5–12 (previous 8 weeks) */
  uploadsOlder8w: number;
  /** Median age in days of outlier videos (score >= 3). null if none. */
  medianOutlierAgeDays: number | null;
  /** Total videos attached to the topic */
  totalVideos: number;
  /** Qualified videos published in the last 72 h (used with thresholds). */
  qualifiedIn72h?: number;
  /** Qualified supply O_q (used with thresholds; null = unknown). */
  supplyQ?: number | null;
}

/** Settings → Scoring thresholds that the phase actually uses. */
export interface PhaseThresholds {
  /** Above this qualified supply, a topic cannot be in the ideal window (phase 2). */
  phase2MaxSupply: number;
  /** From this many qualified videos in 72 h, the topic is saturating (phase 3). */
  phase3QualifiedIn72h: number;
}

export function computePhase(inputs: PhaseInputs, thresholds?: PhaseThresholds): number {
  const { uploadsRecent4w, uploadsOlder8w, medianOutlierAgeDays, totalVideos } = inputs;

  // Emergence: very few videos overall
  if (totalVideos < 5) return 0;

  // Burst of qualified competition (Réglages : « Vidéos qualifiées en 72h pour Phase 3 »).
  if (thresholds && (inputs.qualifiedIn72h ?? 0) >= thresholds.phase3QualifiedIn72h) return 3;

  // Weekly upload rates
  const recentWeekly = uploadsRecent4w / 4;
  const olderWeekly = uploadsOlder8w / 8;

  // Slope: ratio of recent vs older weekly rate
  // Avoid division by zero: if no older uploads, treat as infinite growth
  let slope: number;
  if (olderWeekly === 0) {
    slope = uploadsRecent4w > 0 ? 3.0 : 1.0;
  } else {
    slope = recentWeekly / olderWeekly;
  }

  // Outlier age signal
  const youngOutliers = medianOutlierAgeDays !== null && medianOutlierAgeDays < 14;
  const oldOutliers = medianOutlierAgeDays !== null && medianOutlierAgeDays > 60;

  // Saturation: decelerating OR very high volume with old outliers
  if (slope < 0.5 || (uploadsRecent4w >= 10 && oldOutliers)) {
    return 3;
  }

  // Window: accelerating with young outliers OR strong slope
  // (Réglages : « Max supply pour Phase 2 » — too much qualified supply is not a window.)
  const supplyOk = !thresholds || inputs.supplyQ == null || inputs.supplyQ <= thresholds.phase2MaxSupply;
  if (supplyOk && ((slope > 2 && uploadsRecent4w >= 3) || (slope > 1.5 && youngOutliers))) {
    return 2;
  }

  // Emergence: very low upload pace overall
  if (uploadsRecent4w + uploadsOlder8w < 5) {
    return 0;
  }

  // Default: short virality
  return 1;
}
