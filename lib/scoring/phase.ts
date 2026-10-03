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
}

export function computePhase(inputs: PhaseInputs): number {
  const { uploadsRecent4w, uploadsOlder8w, medianOutlierAgeDays, totalVideos } = inputs;

  // Emergence: very few videos overall
  if (totalVideos < 5) return 0;

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
  if ((slope > 2 && uploadsRecent4w >= 3) || (slope > 1.5 && youngOutliers)) {
    return 2;
  }

  // Emergence: very low upload pace overall
  if (uploadsRecent4w + uploadsOlder8w < 5) {
    return 0;
  }

  // Default: short virality
  return 1;
}
