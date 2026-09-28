// ── Pure outlier scoring functions — no DB access, fully testable ──────

export interface VideoSnapshot {
  videoId: string;
  capturedAt: string; // ISO timestamp
  views: number;
}

export interface VideoInfo {
  id: string;
  channelId: string;
  publishedAt: string; // ISO timestamp
}

export interface OutlierResult {
  videoId: string;
  score: number;       // views / baseline
  baseline: number;    // median views of previous videos
  ageDays: number;     // age of video when measured
  method: 'same_age' | 'approximate';
}

/**
 * Compute the median of an array of numbers.
 * Returns 0 for empty arrays.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Get the views of a video at a specific age (in days) from its snapshots.
 * Finds the snapshot closest to `publishedAt + ageDays` days.
 * Returns null if no snapshot is close enough (within 2 days).
 */
export function getViewsAtAge(
  snapshots: VideoSnapshot[],
  publishedAt: string,
  ageDays: number,
): number | null {
  if (snapshots.length === 0) return null;

  const pubTime = new Date(publishedAt).getTime();
  const targetTime = pubTime + ageDays * 86_400_000;

  let best: VideoSnapshot | null = null;
  let bestDiff = Infinity;

  for (const snap of snapshots) {
    const diff = Math.abs(new Date(snap.capturedAt).getTime() - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = snap;
    }
  }

  // Allow up to 2 days tolerance
  if (!best || bestDiff > 2 * 86_400_000) return null;
  return best.views;
}

/**
 * Get the latest views from snapshots.
 */
export function getLatestViews(snapshots: VideoSnapshot[]): number | null {
  if (snapshots.length === 0) return null;
  let latest = snapshots[0];
  for (const snap of snapshots) {
    if (new Date(snap.capturedAt).getTime() > new Date(latest.capturedAt).getTime()) {
      latest = snap;
    }
  }
  return latest.views;
}

/**
 * Compute outlier score for a single video.
 *
 * Algorithm:
 * 1. Determine the video's age in days.
 * 2. Find the 10 previous videos from the same channel (by published_at).
 * 3. For each previous video, get views at the same age from video_snapshots.
 * 4. If ≥3 previous videos have same-age data, use median of those → method='same_age'.
 * 5. Otherwise, fall back to latest views of previous videos → method='approximate'.
 * 6. Score = video's views at age N / median baseline.
 *
 * @param video The video to score
 * @param videoSnapshots All snapshots for this video
 * @param previousVideos Up to 10 previous videos from same channel, ordered by published_at desc
 * @param previousSnapshots Map of video_id → snapshots for each previous video
 */
export function computeOutlierScore(
  video: VideoInfo,
  videoSnapshots: VideoSnapshot[],
  previousVideos: VideoInfo[],
  previousSnapshots: Map<string, VideoSnapshot[]>,
): OutlierResult | null {
  if (previousVideos.length === 0) return null;

  const pubTime = new Date(video.publishedAt).getTime();
  const ageDays = Math.floor((Date.now() - pubTime) / 86_400_000);
  if (ageDays < 1) return null;

  // Get this video's views at its current age
  const currentViews = getLatestViews(videoSnapshots);
  if (currentViews === null || currentViews === 0) return null;

  // Try same-age method: get views of previous videos at the same age
  const sameAgeViews: number[] = [];
  for (const prev of previousVideos) {
    const prevSnaps = previousSnapshots.get(prev.id) ?? [];
    const viewsAtAge = getViewsAtAge(prevSnaps, prev.publishedAt, ageDays);
    if (viewsAtAge !== null && viewsAtAge > 0) {
      sameAgeViews.push(viewsAtAge);
    }
  }

  if (sameAgeViews.length >= 3) {
    const baseline = median(sameAgeViews);
    if (baseline > 0) {
      return {
        videoId: video.id,
        score: currentViews / baseline,
        baseline,
        ageDays,
        method: 'same_age',
      };
    }
  }

  // Fallback: use latest views of previous videos
  const latestViews: number[] = [];
  for (const prev of previousVideos) {
    const prevSnaps = previousSnapshots.get(prev.id) ?? [];
    const views = getLatestViews(prevSnaps);
    if (views !== null && views > 0) {
      latestViews.push(views);
    }
  }

  if (latestViews.length === 0) return null;

  const baseline = median(latestViews);
  if (baseline <= 0) return null;

  return {
    videoId: video.id,
    score: currentViews / baseline,
    baseline,
    ageDays,
    method: 'approximate',
  };
}

// ── Outlier badge thresholds ─────────────────────────────────────────

export interface OutlierBadgeInfo {
  label: string;
  color: string;
}

/**
 * Get badge info for an outlier score using the sequential MGI scale.
 * Thresholds: ≥10× → darkest, ≥5× → dark, ≥3× → medium, ≥1.5× → light, <1.5× → lightest
 */
export function getOutlierBadge(score: number): OutlierBadgeInfo {
  if (score >= 10) return { label: '10×+', color: '#443cc6' };
  if (score >= 5) return { label: `${Math.round(score)}×`, color: '#646cd8' };
  if (score >= 3) return { label: `${score.toFixed(1)}×`, color: '#8c97e9' };
  if (score >= 1.5) return { label: `${score.toFixed(1)}×`, color: '#b7c0f8' };
  return { label: `${score.toFixed(1)}×`, color: '#e2e6ff' };
}
