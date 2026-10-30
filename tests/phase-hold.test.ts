import { describe, expect, it } from 'vitest';
import { applyPhase3Hold, computePhase, PHASE3_HOLD_DAYS } from '@/lib/scoring/phase';

const thresholds = { phase2MaxSupply: 3, phase3QualifiedIn72h: 5 };
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);

/** Accelerating topic (slope > 2), young outliers: phase 2 without a burst. */
const base = { uploadsRecent4w: 12, uploadsOlder8w: 6, medianOutlierAgeDays: 10, totalVideos: 40, supplyQ: 1 };

/** Runs the nightly phase computation over several nights, like runScore does. */
function simulate(nights: { burst: boolean; inputs?: Partial<typeof base> }[]) {
  const history: { scored_at: string; phase: number | null }[] = [{ scored_at: day(-1), phase: 2 }];
  const phases: number[] = [];
  let changes = 0;
  nights.forEach((n, i) => {
    const today = day(i);
    const computed = computePhase({ ...base, ...n.inputs, qualifiedIn72h: n.burst ? 6 : 0 }, thresholds);
    const phase = applyPhase3Hold(computed, history, today);
    if (phase !== history[history.length - 1].phase) changes++;
    history.push({ scored_at: today, phase });
    phases.push(phase);
  });
  return { phases, changes };
}

describe('phase 3 hysteresis', () => {
  it('a 72 h burst on night 1 keeps phase 3 for the following nights: one single change', () => {
    const { phases, changes } = simulate([{ burst: true }, { burst: true }, { burst: false }, { burst: false }, { burst: false }]);
    expect(phases).toEqual([3, 3, 3, 3, 3]);
    expect(changes).toBe(1); // 2 → 3 only, no "back to phase 2" alert
  });

  it('back to phase 2 only after the hold, not before', () => {
    const nights = [{ burst: true }, ...Array.from({ length: PHASE3_HOLD_DAYS + 2 }, () => ({ burst: false }))];
    const { phases, changes } = simulate(nights);
    const firstBack = phases.findIndex((p) => p !== 3);
    expect(firstBack).toBe(PHASE3_HOLD_DAYS);
    expect(changes).toBe(2); // 2 → 3, then 3 → 2 once, after the hold
  });

  it('a real collapse of activity (phase 0) is not held', () => {
    const { phases } = simulate([
      { burst: true },
      { burst: false, inputs: { uploadsRecent4w: 0, uploadsOlder8w: 2, totalVideos: 4 } },
    ]);
    expect(phases).toEqual([3, 0]);
  });

  it('without a previous phase 3 nothing changes', () => {
    expect(applyPhase3Hold(2, [{ scored_at: day(0), phase: 2 }], day(1))).toBe(2);
    expect(applyPhase3Hold(1, [], day(1))).toBe(1);
  });
});
