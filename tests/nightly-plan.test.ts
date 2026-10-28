import { describe, expect, it } from 'vitest';
import { planWindow, tailReserveMs } from '@/lib/jobs/nightly-plan';

const MIN = 60_000;

describe('nightly time plan', () => {
  it('keeps the tail reserve even when every step uses its full window', () => {
    const deadlineMs = 60 * MIN;
    const start = 0;
    const hard = start + deadlineMs;
    const reserve = tailReserveMs(deadlineMs);
    // Step maxima much larger than the run, like the real nightly.
    const maxima = [18, 9, 10, 10, 5, 4, 8, 12, 4, 6, 4, 8, 8, 6].map((m) => m * MIN);
    let now = start;
    let planned = 0;
    for (const max of maxima) {
      const w = planWindow(now, hard, max, reserve);
      if (w.skip) continue;
      planned += w.plannedMs;
      now = w.end; // the step takes all its window
    }
    expect(now).toBeLessThanOrEqual(hard - reserve);
    expect(planned).toBeLessThanOrEqual(deadlineMs - reserve);
    expect(hard - now).toBeGreaterThanOrEqual(reserve);
  });

  it('skips a step when less than 30 s are left', () => {
    const w = planWindow(1000, 1000 + 20_000, 5 * MIN, 0);
    expect(w.skip).toBe(true);
  });

  it('caps the reserve to a quarter of short runs', () => {
    expect(tailReserveMs(15 * MIN)).toBe(Math.floor(15 * MIN * 0.25));
    expect(tailReserveMs(100 * MIN)).toBe(8 * MIN);
  });
});
