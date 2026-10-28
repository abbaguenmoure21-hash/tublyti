import { describe, expect, it } from 'vitest';
import { shiftedProb } from '@/lib/preflight/engine';

describe('shiftedProb (no model)', () => {
  it('keeps the base probability when delta = 0', () => {
    expect(shiftedProb(0.12, 0, Math.log(2), 0)).toBeCloseTo(0.12, 3);
  });

  it('is monotone and stays a probability for a large boost', () => {
    const delta = Math.log(1.3 * Math.sqrt(3));
    const ps = [0, 0.2, 0.5, delta, 2, 5].map((d) => shiftedProb(0.12, 0, Math.log(2), d));
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1]);
    for (const p of ps) expect(p).toBeLessThan(1);
    expect(ps[3]).toBeGreaterThan(0.12);
  });

  it('goes down for a negative shift', () => {
    expect(shiftedProb(0.12, 0, Math.log(2), -0.5)).toBeLessThan(0.12);
  });
});
