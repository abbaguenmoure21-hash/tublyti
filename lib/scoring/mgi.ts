// ── Pure scoring functions — no DB access, fully testable ──────────────

export interface MGIInputs {
  demand: number;        // 0–1
  frustration: number;   // 0–1
  supplyQualified: number;
  monetization: number;
}

export function computeMGI(inputs: MGIInputs): number {
  const { demand, frustration, supplyQualified, monetization } = inputs;
  return (demand * (1 + frustration)) / (1 + supplyQualified) * monetization;
}

// ── Percentile ────────────────────────────────────────────────────────

/**
 * Compute percentile rank (0–100) of `value` among `allValues`.
 * Ties get the mid-rank (average rank of the tied group): 5 equal values → 50 each,
 * instead of 0 for all (which pushed whole niches with zero demand to "Très faible").
 * Distinct values keep the same scale as before (min → 0, max → 100).
 * Single-element array → 50 (median by convention).
 */
export function computePercentile(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 50;
  let below = 0;
  let equal = 0;
  for (const v of allValues) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  // value absent from the list: behaves as before (rank = number of values below).
  const rank = equal > 0 ? below + (equal - 1) / 2 : below;
  return Math.min(100, (rank / (allValues.length - 1)) * 100);
}

/** Below this number of scoreable topics in a niche, a within-niche rank means nothing. */
export const MIN_TOPICS_FOR_RANK = 3;

// ── YouTube-based Demand ──────────────────────────────────────────────

/**
 * Raw demand signals computed from YouTube data for a single topic.
 */
export interface TopicYTDemand {
  velocity: number;      // median views/day for videos < 30 days
  outlierRatio: number;  // median of video outlier scores
  outlierCount: number;  // count of videos with outlier score >= 3
}

/**
 * Compute demand D ∈ [0, 1] using YouTube signals, normalized as
 * percentiles within the niche.
 *
 *   D = 0.4 × velocity_pctl + 0.4 × outlierRatio_pctl + 0.2 × outlierCount_pctl
 *
 * Each percentile is computed against allInNiche (all topics in the same niche).
 */
export function computeYTDemand(
  topic: TopicYTDemand,
  allInNiche: TopicYTDemand[],
): number {
  if (allInNiche.length === 0) return 0;

  const velPctl = computePercentile(topic.velocity, allInNiche.map((t) => t.velocity)) / 100;
  const ratioPctl = computePercentile(topic.outlierRatio, allInNiche.map((t) => t.outlierRatio)) / 100;
  const countPctl = computePercentile(topic.outlierCount, allInNiche.map((t) => t.outlierCount)) / 100;

  return 0.4 * velPctl + 0.4 * ratioPctl + 0.2 * countPctl;
}

// ── Frustration ───────────────────────────────────────────────────────

/**
 * F = weighted proportion of topic comments with frustration label.
 * frustrationLikeWeighted = sum of (1 + like_count) for frustration comments
 * totalLikeWeighted = sum of (1 + like_count) for all labeled comments
 */
export function computeFrustration(
  frustrationWeighted: number,
  totalWeighted: number,
): number {
  if (totalWeighted === 0) return 0;
  return frustrationWeighted / totalWeighted;
}

// ── Supply Qualified ──────────────────────────────────────────────────

/**
 * O_q = count of long quality videos (>= 8 min, channel >= 10k subs)
 *       published in last 90 days, divided by the niche median count.
 * Result >= 0. If niche median is 0, use 1 to avoid division by zero.
 */
export function computeSupplyQ(
  topicLongQualityCount: number,
  nicheMedianLongQuality: number,
): number {
  const denom = nicheMedianLongQuality > 0 ? nicheMedianLongQuality : 1;
  return topicLongQualityCount / denom;
}

// ── Confidence ──────────────────────────────────────────────────────

export interface ConfidenceInputs {
  videoCount: number;     // videos attached to this topic
  commentCount: number;
  hasOutlierData: boolean;
}

export interface ConfidenceResult {
  level: 'high' | 'medium' | 'low' | 'insufficient';
  reason: string;
}

/**
 * Confidence = how much we trust the MGI score.
 * - insufficient: < 5 videos → MGI = null
 * - low: 5–9 videos or < 20 comments
 * - points: videos (>=20: 2, >=10: 1), comments (>=50: 2, >=20: 1), outlier data (1)
 * - high: >= 4 points (e.g. 20 videos + 50 comments, even without outlier data)
 * - medium: 2–3 points ; low: 0–1 point
 */
export function computeConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  const { videoCount, commentCount, hasOutlierData } = inputs;

  if (videoCount < 5) {
    return { level: 'insufficient', reason: `${videoCount} vidéos seulement (min 5)` };
  }

  let score = 0;
  const reasons: string[] = [];

  if (videoCount >= 20) score += 2;
  else if (videoCount >= 10) score += 1;
  else reasons.push(`${videoCount} vidéos`);

  if (commentCount >= 50) score += 2;
  else if (commentCount >= 20) score += 1;
  else reasons.push(`${commentCount} commentaires`);

  if (hasOutlierData) score += 1;
  else reasons.push('pas de données outlier');

  if (score >= 4) return { level: 'high', reason: 'Données abondantes' };
  if (score >= 2) return { level: 'medium', reason: reasons.length > 0 ? reasons.join(', ') : 'Données partielles' };
  return { level: 'low', reason: reasons.join(', ') || 'Données insuffisantes' };
}

// ── MGI Band ────────────────────────────────────────────────────────

export type MgiBand = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';

export interface MgiBandInfo {
  band: MgiBand;
  label: string;
  color: string;
}

const MGI_BANDS: MgiBandInfo[] = [
  { band: 'very_low', label: 'Très faible', color: '#e2e6ff' },
  { band: 'low', label: 'Faible', color: '#b7c0f8' },
  { band: 'medium', label: 'Moyen', color: '#8c97e9' },
  { band: 'high', label: 'Fort', color: '#646cd8' },
  { band: 'very_high', label: 'Très fort', color: '#443cc6' },
];

export function getMgiBand(value: number): MgiBandInfo {
  if (value >= 80) return MGI_BANDS[4];
  if (value >= 60) return MGI_BANDS[3];
  if (value >= 40) return MGI_BANDS[2];
  if (value >= 20) return MGI_BANDS[1];
  return MGI_BANDS[0];
}
