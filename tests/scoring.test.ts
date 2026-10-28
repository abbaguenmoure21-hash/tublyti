import { describe, it, expect } from 'vitest';
import {
  computeMGI,
  computePercentile,
  computeYTDemand,
  computeFrustration,
  computeSupplyQ,
  computeConfidence,
  type TopicYTDemand,
} from '@/lib/scoring/mgi';
import { computePhase } from '@/lib/scoring/phase';

// ── computeMGI ──────────────────────────────────────────────────────

describe('computeMGI', () => {
  it('returns 0 when demand is 0', () => {
    expect(
      computeMGI({ demand: 0, frustration: 0.5, supplyQualified: 2, monetization: 1.5 }),
    ).toBe(0);
  });

  it('increases with frustration', () => {
    const low = computeMGI({ demand: 50, frustration: 0.1, supplyQualified: 2, monetization: 1 });
    const high = computeMGI({ demand: 50, frustration: 0.8, supplyQualified: 2, monetization: 1 });
    expect(high).toBeGreaterThan(low);
  });

  it('decreases with supply', () => {
    const low = computeMGI({ demand: 50, frustration: 0.5, supplyQualified: 1, monetization: 1 });
    const high = computeMGI({ demand: 50, frustration: 0.5, supplyQualified: 10, monetization: 1 });
    expect(low).toBeGreaterThan(high);
  });

  it('handles zero supply (O_q = 0)', () => {
    const result = computeMGI({ demand: 50, frustration: 0.5, supplyQualified: 0, monetization: 1 });
    // D × (1 + F) / (1 + 0) × P = 50 × 1.5 / 1 × 1 = 75
    expect(result).toBe(75);
  });

  it('scales with monetization', () => {
    const base = computeMGI({ demand: 50, frustration: 0.5, supplyQualified: 2, monetization: 1 });
    const doubled = computeMGI({ demand: 50, frustration: 0.5, supplyQualified: 2, monetization: 2 });
    expect(doubled).toBeCloseTo(base * 2);
  });
});

// ── computePercentile ───────────────────────────────────────────────

describe('computePercentile', () => {
  it('returns 50 for a single value', () => {
    expect(computePercentile(42, [42])).toBe(50);
  });

  it('returns 0 for the smallest value', () => {
    expect(computePercentile(10, [10, 20, 30, 40, 50])).toBe(0);
  });

  it('returns 100 for the largest value', () => {
    expect(computePercentile(50, [10, 20, 30, 40, 50])).toBe(100);
  });

  it('returns correct percentile for middle value', () => {
    expect(computePercentile(30, [10, 20, 30, 40, 50])).toBe(50);
  });

  it('returns 50 for empty array', () => {
    expect(computePercentile(10, [])).toBe(50);
  });

  it('gives the mid-rank to ties (5 equal values -> 50 each)', () => {
    expect(computePercentile(0, [0, 0, 0, 0, 0])).toBe(50);
  });

  it('ties share their average rank', () => {
    // ranks 0,1,2 for the three zeros -> 1 -> 25 ; 40 is the max -> 100
    expect(computePercentile(0, [0, 0, 0, 10, 40])).toBe(25);
    expect(computePercentile(40, [0, 0, 0, 10, 40])).toBe(100);
  });
});

// ── computeYTDemand ─────────────────────────────────────────────────

describe('computeYTDemand', () => {
  const allInNiche: TopicYTDemand[] = [
    { velocity: 100, outlierRatio: 1.0, outlierCount: 0 },
    { velocity: 200, outlierRatio: 2.0, outlierCount: 1 },
    { velocity: 300, outlierRatio: 3.0, outlierCount: 2 },
    { velocity: 400, outlierRatio: 4.0, outlierCount: 3 },
    { velocity: 500, outlierRatio: 5.0, outlierCount: 4 },
  ];

  it('returns 0 for empty niche', () => {
    expect(computeYTDemand({ velocity: 100, outlierRatio: 1, outlierCount: 0 }, [])).toBe(0);
  });

  it('returns ~0.5 for middle topic', () => {
    const result = computeYTDemand(allInNiche[2], allInNiche);
    expect(result).toBeCloseTo(0.5, 1);
  });

  it('returns 0 for lowest topic', () => {
    const result = computeYTDemand(allInNiche[0], allInNiche);
    expect(result).toBe(0);
  });

  it('returns 1 for highest topic', () => {
    const result = computeYTDemand(allInNiche[4], allInNiche);
    expect(result).toBe(1);
  });

  it('increases with velocity', () => {
    const low = computeYTDemand(allInNiche[1], allInNiche);
    const high = computeYTDemand(allInNiche[3], allInNiche);
    expect(high).toBeGreaterThan(low);
  });
});

// ── computeFrustration ──────────────────────────────────────────────

describe('computeFrustration', () => {
  it('returns 0 when no comments (total = 0)', () => {
    expect(computeFrustration(0, 0)).toBe(0);
  });

  it('returns 0 when no frustration comments', () => {
    expect(computeFrustration(0, 100)).toBe(0);
  });

  it('computes ratio correctly', () => {
    expect(computeFrustration(10, 100)).toBeCloseTo(0.1);
  });

  it('can reach 1.0', () => {
    expect(computeFrustration(50, 50)).toBe(1);
  });
});

// ── computeSupplyQ ──────────────────────────────────────────────────

describe('computeSupplyQ', () => {
  it('returns 0 when no qualified videos', () => {
    expect(computeSupplyQ(0, 10)).toBe(0);
  });

  it('returns count when niche median is 0 (uses 1)', () => {
    expect(computeSupplyQ(5, 0)).toBe(5);
  });

  it('normalizes by niche median', () => {
    expect(computeSupplyQ(10, 5)).toBe(2);
  });

  it('returns < 1 when below niche median', () => {
    expect(computeSupplyQ(3, 10)).toBeCloseTo(0.3);
  });
});

// ── computeConfidence ───────────────────────────────────────────────

describe('computeConfidence', () => {
  it('returns insufficient for < 5 videos', () => {
    expect(computeConfidence({ videoCount: 3, commentCount: 100, hasOutlierData: true }).level).toBe('insufficient');
  });

  it('returns high for abundant data', () => {
    expect(computeConfidence({ videoCount: 25, commentCount: 60, hasOutlierData: true }).level).toBe('high');
  });

  it('returns low for minimal data', () => {
    expect(computeConfidence({ videoCount: 5, commentCount: 5, hasOutlierData: false }).level).toBe('low');
  });

  it('returns medium for partial data', () => {
    expect(computeConfidence({ videoCount: 12, commentCount: 30, hasOutlierData: false }).level).toBe('medium');
  });
});

// ── computePhase ────────────────────────────────────────────────────

describe('computePhase', () => {
  it('returns 0 (emergence) for < 5 total videos', () => {
    expect(
      computePhase({ uploadsRecent4w: 2, uploadsOlder8w: 1, medianOutlierAgeDays: null, totalVideos: 3 }),
    ).toBe(0);
  });

  it('returns 3 (saturation) when slope < 0.5', () => {
    expect(
      computePhase({ uploadsRecent4w: 1, uploadsOlder8w: 16, medianOutlierAgeDays: null, totalVideos: 20 }),
    ).toBe(3);
  });

  it('returns 3 (saturation) with high volume + old outliers', () => {
    expect(
      computePhase({ uploadsRecent4w: 12, uploadsOlder8w: 10, medianOutlierAgeDays: 90, totalVideos: 30 }),
    ).toBe(3);
  });

  it('returns 2 (window) with strong slope', () => {
    expect(
      computePhase({ uploadsRecent4w: 8, uploadsOlder8w: 4, medianOutlierAgeDays: null, totalVideos: 15 }),
    ).toBe(2);
  });

  it('returns 2 (window) with moderate slope + young outliers', () => {
    expect(
      computePhase({ uploadsRecent4w: 6, uploadsOlder8w: 6, medianOutlierAgeDays: 7, totalVideos: 15 }),
    ).toBe(2);
  });

  it('returns 0 (emergence) when very few total uploads', () => {
    expect(
      computePhase({ uploadsRecent4w: 2, uploadsOlder8w: 2, medianOutlierAgeDays: null, totalVideos: 10 }),
    ).toBe(0);
  });

  it('returns 1 (short virality) as default', () => {
    expect(
      computePhase({ uploadsRecent4w: 5, uploadsOlder8w: 8, medianOutlierAgeDays: 30, totalVideos: 20 }),
    ).toBe(1);
  });

  it('saturation takes priority over window', () => {
    // slope < 0.5 → saturation, even with young outliers
    expect(
      computePhase({ uploadsRecent4w: 1, uploadsOlder8w: 20, medianOutlierAgeDays: 5, totalVideos: 25 }),
    ).toBe(3);
  });
});
