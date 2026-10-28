/**
 * Explicit, additive time plan for the nightly pipeline.
 * Each step gets min(its own maximum, time left − reserve kept for the critical tail steps).
 * Replaces the old percentage windows measured from the start of the run, which contradicted the
 * per-step minimums and made discovery steps skip mechanically.
 */

export interface StepWindow {
  /** Absolute end (ms epoch) the step must respect. */
  end: number;
  /** Planned duration, for the "planned / actual" summary. */
  plannedMs: number;
  /** True when not enough time is left to do anything useful. */
  skip: boolean;
}

export const MIN_USEFUL_MS = 30_000;

export function planWindow(
  now: number,
  hardDeadline: number,
  maxMs: number,
  reserveMs: number,
  minUsefulMs: number = MIN_USEFUL_MS,
): StepWindow {
  const end = Math.min(now + Math.max(0, maxMs), hardDeadline - Math.max(0, reserveMs));
  const plannedMs = Math.max(0, end - now);
  return { end, plannedMs, skip: plannedMs < minUsefulMs };
}

/** Time kept for classify + score at the end of the night: 8 min, at most a quarter of the run. */
export function tailReserveMs(deadlineMs: number): number {
  return Math.min(8 * 60_000, Math.floor(deadlineMs * 0.25));
}
