/**
 * Channel context "as known at time t", shared by the training script and the
 * pre-publication prediction, so both build exactly the same features.
 *
 * Rules (no look-ahead):
 *  - a previous video only counts once its 7-day mark is reached before t
 *    (its 7-day views did not exist earlier);
 *  - "usual views" = median of the 7-day views of the 12 most recent such videos
 *    (same definition as the real result measured after publication, see
 *    lib/preflight/engine.ts baselineAt);
 *  - "momentum" = mean log 7-day score of the 5 most recent such videos.
 */

export type Snap = { at: number; views: number };

/** Fixed horizon of the target: views at 7 days ÷ usual 7-day views of the channel. */
export const HORIZON_DAYS = 7;
const DAY = 86_400_000;

export const clampLog = (s: number) => Math.log(Math.min(100, Math.max(0.05, s)));

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Views at a given age, from the closest snapshot within tolerance (same rule as the follow-up). */
export function viewsAt(snaps: Snap[], publishedMs: number, ageDays: number): number | null {
  const target = publishedMs + ageDays * DAY;
  const tol = Math.max(1.5, ageDays * 0.25) * DAY;
  let best: Snap | null = null;
  for (const s of snaps) if (Math.abs(s.at - target) <= tol && (!best || Math.abs(s.at - target) < Math.abs(best.at - target))) best = s;
  return best ? best.views : null;
}

/**
 * Weekly aggregates (video_stats_weekly: max views of the ISO week) as snapshots
 * dated at the end of their week, so videos older than the 30-day purge still
 * have an (approximate) 7-day value.
 */
export function weeklyToSnaps(rows: { week_start: string; views: number }[]): Snap[] {
  return rows.map((r) => ({ at: new Date(`${r.week_start}T00:00:00Z`).getTime() + 7 * DAY - 1, views: Number(r.views) || 0 }));
}

export interface ChannelVideo {
  id: string;
  publishedMs: number;
  /** Views at HORIZON_DAYS, null when not measured. */
  views7d: number | null;
}

/** Previous videos whose 7-day value was known at time t, most recent first. */
function knownBefore(history: ChannelVideo[], t: number): ChannelVideo[] {
  return history
    .filter((v) => v.publishedMs + HORIZON_DAYS * DAY <= t && v.views7d !== null && v.views7d > 0)
    .sort((a, b) => b.publishedMs - a.publishedMs);
}

/** Usual 7-day views of the channel at time t (null below 3 measured videos). */
export function baselineBefore(history: ChannelVideo[], t: number): number | null {
  const vals = knownBefore(history, t)
    .slice(0, 12)
    .map((v) => v.views7d as number);
  return vals.length >= 3 ? median(vals) : null;
}

/** 7-day over-performance score of a video (null if unmeasurable). */
export function score7d(history: ChannelVideo[], v: ChannelVideo): number | null {
  if (v.views7d === null || !(v.views7d > 0)) return null;
  const base = baselineBefore(history, v.publishedMs);
  return base ? v.views7d / base : null;
}

export interface ChannelContext {
  baselineViews: number | null;
  momentum: number | null;
  daysSincePrev: number | null;
  /** Latest moment a value used here became known (7-day mark of the newest video used). */
  latestSourceMs: number | null;
}

export function channelContextAt(history: ChannelVideo[], t: number): ChannelContext {
  const prevAny = history.filter((v) => v.publishedMs < t).sort((a, b) => b.publishedMs - a.publishedMs)[0];
  const known = knownBefore(history, t);
  const scores: number[] = [];
  for (const v of known) {
    const s = score7d(history, v);
    if (s !== null) scores.push(clampLog(s));
    if (scores.length === 5) break;
  }
  return {
    baselineViews: baselineBefore(history, t),
    momentum: scores.length >= 2 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    daysSincePrev: prevAny ? (t - prevAny.publishedMs) / DAY : null,
    latestSourceMs: known.length ? known[0].publishedMs + HORIZON_DAYS * DAY : null,
  };
}

/** Latest topic score dated before the publication day (no score computed after publication). */
export function topicScoreBefore(
  scores: { scored_at: string; mgi: number | null; phase: number | null }[],
  t: number,
): { mgi: number | null; phase: number | null } | null {
  // Scores are computed during the night: one dated the publication day may already include the video.
  const day = new Date(t).toISOString().slice(0, 10);
  let best: { scored_at: string; mgi: number | null; phase: number | null } | null = null;
  for (const s of scores) {
    if (s.scored_at >= day) continue;
    if (!best || s.scored_at > best.scored_at) best = s;
  }
  return best ? { mgi: best.mgi === null ? null : Number(best.mgi), phase: best.phase === null ? null : Number(best.phase) } : null;
}
