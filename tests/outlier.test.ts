import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  median,
  getViewsAtAge,
  getLatestViews,
  computeOutlierScore,
  getOutlierBadge,
  type VideoSnapshot,
  type VideoInfo,
} from '@/lib/scoring/outlier';

// ── median ──────────────────────────────────────────────────────────

describe('median', () => {
  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns the single value for one element', () => {
    expect(median([42])).toBe(42);
  });

  it('returns middle value for odd-length array', () => {
    expect(median([1, 3, 5])).toBe(3);
  });

  it('returns average of two middle values for even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles unsorted input', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
});

// ── getViewsAtAge ───────────────────────────────────────────────────

describe('getViewsAtAge', () => {
  const publishedAt = '2025-01-01T00:00:00Z';

  it('returns null for empty snapshots', () => {
    expect(getViewsAtAge([], publishedAt, 7)).toBeNull();
  });

  it('returns views of closest snapshot within tolerance', () => {
    const snaps: VideoSnapshot[] = [
      { videoId: 'v1', capturedAt: '2025-01-07T12:00:00Z', views: 1000 },
      { videoId: 'v1', capturedAt: '2025-01-14T00:00:00Z', views: 2000 },
    ];
    // At 7 days, target is Jan 8 00:00. Closest is Jan 7 12:00 (12h off).
    expect(getViewsAtAge(snaps, publishedAt, 7)).toBe(1000);
  });

  it('returns null if no snapshot within 2-day tolerance', () => {
    const snaps: VideoSnapshot[] = [
      { videoId: 'v1', capturedAt: '2025-01-20T00:00:00Z', views: 5000 },
    ];
    // At 7 days, target is Jan 8. Closest is Jan 20 (12 days off).
    expect(getViewsAtAge(snaps, publishedAt, 7)).toBeNull();
  });

  it('picks the closest snapshot when multiple are present', () => {
    const snaps: VideoSnapshot[] = [
      { videoId: 'v1', capturedAt: '2025-01-06T00:00:00Z', views: 800 },
      { videoId: 'v1', capturedAt: '2025-01-08T00:00:00Z', views: 1200 },
      { videoId: 'v1', capturedAt: '2025-01-10T00:00:00Z', views: 1500 },
    ];
    // At 7 days, target is Jan 8 00:00. Exact match = 1200.
    expect(getViewsAtAge(snaps, publishedAt, 7)).toBe(1200);
  });
});

// ── getLatestViews ──────────────────────────────────────────────────

describe('getLatestViews', () => {
  it('returns null for empty snapshots', () => {
    expect(getLatestViews([])).toBeNull();
  });

  it('returns views of the latest snapshot', () => {
    const snaps: VideoSnapshot[] = [
      { videoId: 'v1', capturedAt: '2025-01-07T00:00:00Z', views: 1000 },
      { videoId: 'v1', capturedAt: '2025-01-14T00:00:00Z', views: 2000 },
      { videoId: 'v1', capturedAt: '2025-01-10T00:00:00Z', views: 1500 },
    ];
    expect(getLatestViews(snaps)).toBe(2000);
  });
});

// ── computeOutlierScore ─────────────────────────────────────────────

describe('computeOutlierScore', () => {
  const NOW = new Date('2025-02-01T00:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeVideo = (id: string, publishedAt: string, channelId = 'ch1'): VideoInfo => ({
    id,
    channelId,
    publishedAt,
  });

  const makeSnap = (videoId: string, capturedAt: string, views: number): VideoSnapshot => ({
    videoId,
    capturedAt,
    views,
  });

  it('returns null when no previous videos', () => {
    const video = makeVideo('v1', '2025-01-10T00:00:00Z');
    const snaps = [makeSnap('v1', '2025-01-31T00:00:00Z', 10000)];
    expect(computeOutlierScore(video, snaps, [], new Map())).toBeNull();
  });

  it('returns null when video is less than 1 day old', () => {
    const video = makeVideo('v1', '2025-01-31T18:00:00Z'); // < 1 day old
    const snaps = [makeSnap('v1', '2025-02-01T00:00:00Z', 10000)];
    const prev = [makeVideo('v0', '2025-01-01T00:00:00Z')];
    expect(computeOutlierScore(video, snaps, prev, new Map())).toBeNull();
  });

  it('returns null when video has 0 views', () => {
    const video = makeVideo('v1', '2025-01-10T00:00:00Z');
    const snaps = [makeSnap('v1', '2025-01-31T00:00:00Z', 0)];
    const prev = [makeVideo('v0', '2025-01-01T00:00:00Z')];
    const prevSnaps = new Map([['v0', [makeSnap('v0', '2025-01-31T00:00:00Z', 1000)]]]);
    expect(computeOutlierScore(video, snaps, prev, prevSnaps)).toBeNull();
  });

  it('uses same_age method when 3+ previous videos have same-age data', () => {
    const video = makeVideo('v4', '2025-01-15T00:00:00Z');
    // Video is 17 days old (Jan 15 → Feb 1)
    const videoSnaps = [makeSnap('v4', '2025-01-31T00:00:00Z', 5000)];

    const prev = [
      makeVideo('v3', '2025-01-01T00:00:00Z'),
      makeVideo('v2', '2024-12-15T00:00:00Z'),
      makeVideo('v1', '2024-12-01T00:00:00Z'),
    ];

    // Each previous video has a snapshot at ~17 days after their publish date
    const prevSnaps = new Map<string, VideoSnapshot[]>([
      ['v3', [makeSnap('v3', '2025-01-18T00:00:00Z', 1000)]], // 17 days after Jan 1
      ['v2', [makeSnap('v2', '2025-01-01T00:00:00Z', 2000)]], // 17 days after Dec 15
      ['v1', [makeSnap('v1', '2024-12-18T00:00:00Z', 1500)]], // 17 days after Dec 1
    ]);

    const result = computeOutlierScore(video, videoSnaps, prev, prevSnaps);
    expect(result).not.toBeNull();
    expect(result!.method).toBe('same_age');
    // Median of [1000, 1500, 2000] = 1500. Score = 5000/1500 ≈ 3.33
    expect(result!.baseline).toBe(1500);
    expect(result!.score).toBeCloseTo(5000 / 1500, 2);
  });

  it('falls back to approximate when same-age data insufficient', () => {
    const video = makeVideo('v3', '2025-01-15T00:00:00Z');
    const videoSnaps = [makeSnap('v3', '2025-01-31T00:00:00Z', 8000)];

    const prev = [
      makeVideo('v2', '2025-01-01T00:00:00Z'),
      makeVideo('v1', '2024-12-01T00:00:00Z'),
    ];

    // Only 1 has same-age data (need ≥3)
    const prevSnaps = new Map<string, VideoSnapshot[]>([
      ['v2', [makeSnap('v2', '2025-01-18T00:00:00Z', 1000)]],
      ['v1', [makeSnap('v1', '2025-01-30T00:00:00Z', 3000)]], // too far from 17-day mark
    ]);

    const result = computeOutlierScore(video, videoSnaps, prev, prevSnaps);
    expect(result).not.toBeNull();
    expect(result!.method).toBe('approximate');
    // Latest views: v2=1000, v1=3000. Median = 2000. Score = 8000/2000 = 4
    expect(result!.baseline).toBe(2000);
    expect(result!.score).toBe(4);
  });

  it('handles channel with fewer than 10 previous videos', () => {
    const video = makeVideo('v2', '2025-01-20T00:00:00Z');
    const videoSnaps = [makeSnap('v2', '2025-01-31T00:00:00Z', 6000)];

    // Only 1 previous video
    const prev = [makeVideo('v1', '2025-01-01T00:00:00Z')];
    const prevSnaps = new Map<string, VideoSnapshot[]>([
      ['v1', [makeSnap('v1', '2025-01-31T00:00:00Z', 2000)]],
    ]);

    const result = computeOutlierScore(video, videoSnaps, prev, prevSnaps);
    expect(result).not.toBeNull();
    expect(result!.method).toBe('approximate');
    expect(result!.baseline).toBe(2000);
    expect(result!.score).toBe(3);
  });
});

// ── getOutlierBadge ─────────────────────────────────────────────────

describe('getOutlierBadge', () => {
  it('returns darkest color for score >= 10', () => {
    const badge = getOutlierBadge(12);
    expect(badge.label).toBe('10×+');
    expect(badge.color).toBe('#443cc6');
  });

  it('returns dark color for score >= 5', () => {
    const badge = getOutlierBadge(7);
    expect(badge.label).toBe('7×');
    expect(badge.color).toBe('#646cd8');
  });

  it('returns medium color for score >= 3', () => {
    const badge = getOutlierBadge(3.5);
    expect(badge.label).toBe('3.5×');
    expect(badge.color).toBe('#8c97e9');
  });

  it('returns light color for score >= 1.5', () => {
    const badge = getOutlierBadge(2);
    expect(badge.label).toBe('2.0×');
    expect(badge.color).toBe('#b7c0f8');
  });

  it('returns lightest color for score < 1.5', () => {
    const badge = getOutlierBadge(0.8);
    expect(badge.label).toBe('0.8×');
    expect(badge.color).toBe('#e2e6ff');
  });
});
