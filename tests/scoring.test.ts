import { describe, it, expect } from 'vitest';
import {
  computeMGI,
  computePercentile,
  computeDemand,
  computeFrustration,
  computeSupplyQualified,
  DEFAULT_MGI_WEIGHTS,
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
    // 30 has 2 values below it out of 4 intervals → 50%
    expect(computePercentile(30, [10, 20, 30, 40, 50])).toBe(50);
  });

  it('returns 50 for empty array', () => {
    expect(computePercentile(10, [])).toBe(50);
  });
});

// ── computeDemand ───────────────────────────────────────────────────

describe('computeDemand', () => {
  const allSignals = [
    { trends: 10, ytViews: 100, social: 5 },
    { trends: 20, ytViews: 200, social: 10 },
    { trends: 30, ytViews: 300, social: 15 },
    { trends: 40, ytViews: 400, social: 20 },
    { trends: 50, ytViews: 500, social: 25 },
  ];

  it('returns 0 when all signals are null', () => {
    const signals = { trends: null, ytViews: null, social: null };
    expect(computeDemand(signals, allSignals)).toBe(0);
  });

  it('redistributes weights when one signal is missing', () => {
    // Only trends and ytViews available → weights redistribute
    const signals = { trends: 50, ytViews: 500, social: null };
    const result = computeDemand(signals, allSignals);
    // trends: percentile 100, weight 0.4/(0.4+0.3) ≈ 0.571
    // ytViews: percentile 100, weight 0.3/(0.4+0.3) ≈ 0.429
    // demand ≈ 0.571 × 100 + 0.429 × 100 = 100
    expect(result).toBeCloseTo(100, 0);
  });

  it('redistributes weights when two signals are missing', () => {
    // Only social available
    const signals = { trends: null, ytViews: null, social: 15 };
    const result = computeDemand(signals, allSignals);
    // social: percentile of 15 in [5,10,15,20,25] → 2/4 = 50
    expect(result).toBeCloseTo(50, 0);
  });

  it('computes weighted percentile with all signals', () => {
    // Middle topic: all percentiles = 50
    const signals = allSignals[2]; // trends=30, ytViews=300, social=15
    const result = computeDemand(signals, allSignals);
    // All percentiles are 50, so weighted average = 50
    expect(result).toBeCloseTo(50, 0);
  });
});

// ── computeFrustration ──────────────────────────────────────────────

describe('computeFrustration', () => {
  it('returns 0 when no comments (F = 0)', () => {
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

// ── computeSupplyQualified ──────────────────────────────────────────

describe('computeSupplyQualified', () => {
  it('returns 0 when no qualified videos (O_q = 0)', () => {
    expect(computeSupplyQualified(0, 0)).toBe(0);
  });

  it('counts recent qualified only', () => {
    expect(computeSupplyQualified(5, 0)).toBe(5);
  });

  it('adds 0.3 × old high-view videos', () => {
    expect(computeSupplyQualified(5, 10)).toBeCloseTo(8);
  });
});

// ── computePhase ────────────────────────────────────────────────────

describe('computePhase', () => {
  it('returns 3 (saturation) when >= 5 qualified in 72h', () => {
    expect(
      computePhase({ redditHnRising: false, supplyQualified: 10, trendsGrowth90d: 0.5, qualifiedIn72h: 5 }),
    ).toBe(3);
  });

  it('returns 2 (window) when trends growing and low supply', () => {
    expect(
      computePhase({ redditHnRising: false, supplyQualified: 2, trendsGrowth90d: 0.4, qualifiedIn72h: 0 }),
    ).toBe(2);
  });

  it('returns 0 (emergence) when reddit rising and no supply', () => {
    expect(
      computePhase({ redditHnRising: true, supplyQualified: 0, trendsGrowth90d: 0.1, qualifiedIn72h: 0 }),
    ).toBe(0);
  });

  it('returns 1 (short virality) as default', () => {
    expect(
      computePhase({ redditHnRising: false, supplyQualified: 5, trendsGrowth90d: 0.1, qualifiedIn72h: 2 }),
    ).toBe(1);
  });

  it('saturation takes priority over window', () => {
    expect(
      computePhase({ redditHnRising: true, supplyQualified: 0, trendsGrowth90d: 0.5, qualifiedIn72h: 5 }),
    ).toBe(3);
  });

  it('window takes priority over emergence', () => {
    expect(
      computePhase({ redditHnRising: true, supplyQualified: 0, trendsGrowth90d: 0.4, qualifiedIn72h: 0 }),
    ).toBe(2);
  });
});
