import { DEFAULT_MGI_WEIGHTS, type MGIWeights } from './mgi';

export interface ScoringSettings {
  mgiWeights: MGIWeights;
  thresholds: {
    phase2TrendsGrowth: number;
    phase2MaxSupply: number;
    phase3QualifiedIn72h: number;
  };
}

export const DEFAULT_SCORING: ScoringSettings = {
  mgiWeights: DEFAULT_MGI_WEIGHTS,
  thresholds: {
    phase2TrendsGrowth: 30,
    phase2MaxSupply: 3,
    phase3QualifiedIn72h: 5,
  },
};
