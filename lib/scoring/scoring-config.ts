export interface ScoringSettings {
  thresholds: {
    phase2TrendsGrowth: number;
    phase2MaxSupply: number;
    phase3QualifiedIn72h: number;
  };
}

export const DEFAULT_SCORING: ScoringSettings = {
  thresholds: {
    phase2TrendsGrowth: 30,
    phase2MaxSupply: 3,
    phase3QualifiedIn72h: 5,
  },
};
