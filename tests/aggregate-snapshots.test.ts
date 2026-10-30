import { describe, expect, it } from 'vitest';
import { isoWeekStart, mergeWeekly } from '@/lib/youtube/aggregate-snapshots';

describe('snapshot compaction', () => {
  it('uses the Monday of the ISO week', () => {
    expect(isoWeekStart(new Date('2026-10-28T10:00:00Z'))).toBe('2026-10-26'); // Wednesday
    expect(isoWeekStart(new Date('2026-11-01T23:00:00Z'))).toBe('2026-10-26'); // Sunday
  });

  it('merges a week split across two batches instead of overwriting it', () => {
    const week1 = [
      { video_id: 'v', captured_at: '2026-10-26T02:00:00Z', views: 100, likes: 1, comments: 0 },
      { video_id: 'v', captured_at: '2026-10-27T02:00:00Z', views: 150, likes: 2, comments: 1 },
    ];
    const first = mergeWeekly(week1, []);
    expect(first).toEqual([{ video_id: 'v', week_start: '2026-10-26', views: 150, likes: 2, comments: 1, snapshots_count: 2 }]);
    const second = mergeWeekly(
      [{ video_id: 'v', captured_at: '2026-10-29T02:00:00Z', views: 180, likes: 1, comments: 3 }],
      first,
    );
    expect(second).toEqual([{ video_id: 'v', week_start: '2026-10-26', views: 180, likes: 2, comments: 3, snapshots_count: 3 }]);
  });
});
