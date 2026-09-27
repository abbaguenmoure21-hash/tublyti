// ── Pure scoring functions — no DB access, fully testable ──────────────

export interface MGIInputs {
  demand: number;
  frustration: number;
  supplyQualified: number;
  monetization: number;
}

export function computeMGI(inputs: MGIInputs): number {
  const { demand, frustration, supplyQualified, monetization } = inputs;
  return (demand * (1 + frustration)) / (1 + supplyQualified) * monetization;
}

// ── Weights ────────────────────────────────────────────────────────────

export interface MGIWeights {
  trends: number;  // default 0.4
  ytViews: number; // default 0.3
  social: number;  // default 0.3
}

export const DEFAULT_MGI_WEIGHTS: MGIWeights = {
  trends: 0.4,
  ytViews: 0.3,
  social: 0.3,
};

// ── Percentile ────────────────────────────────────────────────────────

/**
 * Compute percentile rank (0–100) of `value` among `allValues`.
 * Single-element array → 50 (median by convention).
 */
export function computePercentile(value: number, allValues: number[]): number {
  if (allValues.length <= 1) return 50;
  const sorted = [...allValues].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < value).length;
  return (below / (sorted.length - 1)) * 100;
}

// ── Demand ────────────────────────────────────────────────────────────

export interface TopicSignals {
  trends: number | null;
  ytViews: number | null;
  social: number | null; // reddit + hn combined
}

/**
 * Compute demand D as a weighted-average percentile.
 * Missing signals → redistribute weight among available signals.
 */
export function computeDemand(
  signals: TopicSignals,
  allSignals: TopicSignals[],
  weights: MGIWeights = DEFAULT_MGI_WEIGHTS,
): number {
  const entries: { key: keyof TopicSignals; weight: number }[] = [
    { key: 'trends', weight: weights.trends },
    { key: 'ytViews', weight: weights.ytViews },
    { key: 'social', weight: weights.social },
  ];

  const available = entries.filter((e) => signals[e.key] !== null);
  if (available.length === 0) return 0;

  const totalWeight = available.reduce((s, e) => s + e.weight, 0);

  let demand = 0;
  for (const entry of available) {
    const allValues = allSignals
      .map((s) => s[entry.key])
      .filter((v): v is number => v !== null);
    const percentile = computePercentile(signals[entry.key]!, allValues);
    demand += (entry.weight / totalWeight) * percentile;
  }

  return demand;
}

// ── Frustration ───────────────────────────────────────────────────────

/**
 * F = proportion of topic comments with frustration label and confidence ≥ 0.7.
 */
export function computeFrustration(
  frustrationCount: number,
  totalComments: number,
): number {
  if (totalComments === 0) return 0;
  return frustrationCount / totalComments;
}

// ── Supply Qualified ──────────────────────────────────────────────────

/**
 * O_q = qualified videos in 180 days + 0.3 × old videos (≥2 years) still
 * getting ≥ 10k views/month.
 */
export function computeSupplyQualified(
  qualifiedRecent: number,
  oldHighViewCount: number,
): number {
  return qualifiedRecent + 0.3 * oldHighViewCount;
}
