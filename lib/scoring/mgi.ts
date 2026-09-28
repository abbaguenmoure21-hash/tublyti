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

// ── Confidence ──────────────────────────────────────────────────────

export interface ConfidenceInputs {
  commentCount: number;
  demandSourceCount: number; // how many of trends/ytViews/hn/stackexchange are present (0–4)
  dataAgeHours: number;     // hours since last trend_point capture
}

export interface ConfidenceResult {
  level: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Confidence = how much we trust the MGI score.
 * - High: ≥100 comments, ≥3 sources, data <24h old
 * - Low: <50 comments OR 0–1 sources OR data >72h old
 * - Medium: everything else
 */
export function computeConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  const { commentCount, demandSourceCount, dataAgeHours } = inputs;

  const reasons: string[] = [];
  let score = 0;

  // Comments
  if (commentCount >= 100) {
    score += 2;
  } else if (commentCount >= 50) {
    score += 1;
  } else {
    reasons.push(`${commentCount} commentaires seulement`);
  }

  // Demand sources
  if (demandSourceCount >= 3) {
    score += 2;
  } else if (demandSourceCount >= 2) {
    score += 1;
  } else {
    const sourceLabel = demandSourceCount === 0
      ? 'aucune source de demande'
      : '1 seule source de demande';
    reasons.push(sourceLabel);
  }

  // Data freshness
  if (dataAgeHours <= 24) {
    score += 2;
  } else if (dataAgeHours <= 72) {
    score += 1;
  } else {
    reasons.push(`données datant de ${Math.round(dataAgeHours)} h`);
  }

  if (score >= 5) {
    return { level: 'high', reason: 'Données abondantes et récentes' };
  }
  if (score <= 2) {
    return {
      level: 'low',
      reason: reasons.length > 0 ? reasons.join(', ') : 'Données insuffisantes',
    };
  }
  return {
    level: 'medium',
    reason: reasons.length > 0 ? reasons.join(', ') : 'Données partielles',
  };
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
