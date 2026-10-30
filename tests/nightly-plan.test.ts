import { describe, expect, it } from 'vitest';
import { NIGHTLY_SHARES, planWindow, stepBudgetMs, stepMaxMs, tailReserveMs } from '@/lib/jobs/nightly-plan';

const MIN = 60_000;

describe('nightly time plan', () => {
  it('shares sum to 100 %', () => {
    const sum = NIGHTLY_SHARES.reduce((s, [, v]) => s + v, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('with 95 min and every step at its maximum, every step (discovery included) gets its full window', () => {
    const deadlineMs = 95 * MIN;
    const start = 0;
    const budget = stepBudgetMs(deadlineMs);
    const planEnd = start + budget;
    let now = start;
    for (const [kind] of NIGHTLY_SHARES) {
      const max = stepMaxMs(kind, budget);
      const w = planWindow(now, planEnd, max, 0);
      expect(w.skip).toBe(false);
      expect(w.plannedMs).toBeGreaterThanOrEqual(max - 5); // rounding
      now = w.end; // the step takes all its window
    }
    expect(now).toBeLessThanOrEqual(planEnd + NIGHTLY_SHARES.length);
    // Classify + score keep their reserve before the deadline; steps end by the target.
    expect(start + deadlineMs - now).toBeGreaterThanOrEqual(tailReserveMs(deadlineMs));
    expect(budget).toBeLessThanOrEqual(65 * MIN);
    for (const kind of ['discover-topics', 'search', 'discover-channels']) {
      expect(stepMaxMs(kind, budget)).toBeGreaterThanOrEqual(3 * MIN);
    }
  });

  it('skips a step when less than 30 s are left', () => {
    const w = planWindow(1000, 1000 + 20_000, 5 * MIN, 0);
    expect(w.skip).toBe(true);
  });

  it('short local runs: budget = run minus a quarter', () => {
    expect(tailReserveMs(15 * MIN)).toBe(Math.floor(15 * MIN * 0.25));
    expect(stepBudgetMs(15 * MIN)).toBe(15 * MIN - Math.floor(15 * MIN * 0.25));
    expect(tailReserveMs(100 * MIN)).toBe(10 * MIN);
  });
});
