/**
 * Per-user feasibility: compute feasibility grade for a specific user's channel
 * against the competitor subscriber counts stored in topic_scores.
 *
 * Called at display time — NOT during nightly scoring.
 * Each user sees a different grade based on their channel's size.
 */
import { computeFeasibility, type FeasibilityResult } from './feasibility';

/**
 * Compute feasibility for a specific user's channel subscriber count
 * against the stored competitor_subs array from topic_scores.
 *
 * @param userSubs - subscriber count of the user's channel for this niche (null = no channel configured)
 * @param competitorSubs - sorted array of competitor subscriber counts from topic_scores
 * @returns FeasibilityResult with grade, reason, and weight
 */
export function computeFeasibilityForUser(
  userSubs: number | null,
  competitorSubs: number[] | null,
): FeasibilityResult {
  return computeFeasibility(
    userSubs,
    competitorSubs ?? [],
    competitorSubs?.length ?? 0,
  );
}

/**
 * No-channel placeholder: returned when the user hasn't configured a YouTube channel
 * for this niche. The UI should show a prompt to add their channel in settings.
 */
export const NO_CHANNEL_CONFIGURED = null;

export function isNoChannelResult(result: FeasibilityResult): boolean {
  return result.reason.startsWith('Aucune chaîne');
}
