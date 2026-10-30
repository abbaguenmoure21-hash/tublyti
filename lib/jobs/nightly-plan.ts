/**
 * Explicit, additive time plan for the nightly pipeline.
 * Each step gets min(its own maximum, time left before the planned end), computed when it starts.
 * The maxima are shares of one budget that sum to 100 %: when every step uses its full window,
 * every step still runs (discovery is no longer squeezed out by collect + embed), then classify and
 * score use the reserved tail.
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

/** Time kept for classify + score at the end of the night: 10 min, at most a quarter of the run. */
export function tailReserveMs(deadlineMs: number): number {
  return Math.min(10 * 60_000, Math.floor(deadlineMs * 0.25));
}

/** Shares of the step budget, in run order. Sum = 1. */
export const NIGHTLY_SHARES: ReadonlyArray<readonly [string, number]> = [
  ['user-channels', 0.02],
  ['collect', 0.30],
  ['signals', 0.04],
  ['embed', 0.07],
  ['attach', 0.05],
  ['enrich-insufficient', 0.04],
  ['reach', 0.03],
  ['thumb-watch', 0.03],
  ['comments', 0.09],
  ['discover-topics', 0.06],
  ['quality-gates', 0.02],
  ['search-emerging', 0.04],
  ['search', 0.05],
  ['discover-sources', 0.03],
  ['discover-channels', 0.05],
  ['auto-triage', 0.06],
  ['embed-pass2', 0.02],
];

/** Default target for the steps before classify/score (well under the GitHub timeout and the free minutes). */
export const DEFAULT_TARGET_MIN = 65;

/** Budget shared by the planned steps: the run minus the tail reserve, capped by the target. */
export function stepBudgetMs(deadlineMs: number, targetMs: number = DEFAULT_TARGET_MIN * 60_000): number {
  return Math.max(0, Math.min(deadlineMs - tailReserveMs(deadlineMs), targetMs));
}

export function stepMaxMs(kind: string, budgetMs: number): number {
  const share = NIGHTLY_SHARES.find(([k]) => k === kind)?.[1] ?? 0.02;
  return Math.round(share * budgetMs);
}
