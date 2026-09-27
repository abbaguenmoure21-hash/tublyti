import { describe, it, expect } from 'vitest';
import { computeMGI } from '@/lib/scoring/mgi';
import { computePhase } from '@/lib/scoring/phase';

describe('computeMGI', () => {
  it('returns 0 when demand is 0', () => {
    expect(computeMGI({ demand: 0, frustration: 0.5, supplyQualified: 2, monetization: 1.5 })).toBe(0);
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

  it('handles zero supply', () => {
    const result = computeMGI({ demand: 50, frustration: 0.5, supplyQualified: 0, monetization: 1 });
    expect(result).toBe(75);
  });
});

describe('computePhase', () => {
  it('returns 3 (saturation) when >= 5 qualified in 72h', () => {
    expect(computePhase({ redditHnRising: false, supplyQualified: 10, trendsGrowth90d: 0.5, qualifiedIn72h: 5 })).toBe(3);
  });

  it('returns 2 (window) when trends growing and low supply', () => {
    expect(computePhase({ redditHnRising: false, supplyQualified: 2, trendsGrowth90d: 0.4, qualifiedIn72h: 0 })).toBe(2);
  });

  it('returns 0 (emergence) when reddit rising and no supply', () => {
    expect(computePhase({ redditHnRising: true, supplyQualified: 0, trendsGrowth90d: 0.1, qualifiedIn72h: 0 })).toBe(0);
  });

  it('returns 1 (short virality) as default', () => {
    expect(computePhase({ redditHnRising: false, supplyQualified: 5, trendsGrowth90d: 0.1, qualifiedIn72h: 2 })).toBe(1);
  });
});
