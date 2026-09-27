export interface PhaseInputs {
  redditHnRising: boolean;
  supplyQualified: number;
  trendsGrowth90d: number;
  qualifiedIn72h: number;
}

export function computePhase(inputs: PhaseInputs): number {
  const { redditHnRising, supplyQualified, trendsGrowth90d, qualifiedIn72h } = inputs;

  if (qualifiedIn72h >= 5) return 3; // saturation
  if (trendsGrowth90d >= 0.3 && supplyQualified <= 3) return 2; // window
  if (redditHnRising && supplyQualified === 0) return 0; // emergence
  return 1; // short virality
}
