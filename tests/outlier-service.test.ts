import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeChannelOutliers } from '@/lib/scoring/outlier-service';

const DAY = 86_400_000;

/** 100 videos x 365 daily snapshots; returns at most 1 000 rows per call, like PostgREST. */
function fakeDb(upserts: Record<string, unknown>[][]) {
  const now = Date.now();
  const videos = Array.from({ length: 100 }, (_, i) => ({
    id: `v${i}`,
    channel_id: 'c1',
    published_at: new Date(now - (400 + i) * DAY).toISOString(),
  }));
  const snaps: { video_id: string; captured_at: string; views: number }[] = [];
  for (const v of videos) {
    for (let d = 364; d >= 0; d--) {
      const at = now - d * DAY;
      // The very last snapshot of v0 is special: it must be the one used.
      const views = v.id === 'v0' && d === 0 ? 999_999 : 1000 + (364 - d);
      snaps.push({ video_id: v.id, captured_at: new Date(at).toISOString(), views });
    }
  }
  return {
    from(table: string) {
      const state: { ids?: string[]; from?: number; to?: number } = {};
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
      q.in = (_c: string, ids: string[]) => ((state.ids = ids), q);
      q.range = (a: number, b: number) => ((state.from = a), (state.to = b), q);
      q.then = (res: (v: unknown) => unknown) => {
        if (table === 'videos') return Promise.resolve({ data: videos, error: null }).then(res);
        const rows = snaps
          .filter((s) => state.ids?.includes(s.video_id))
          .sort((a, b) => a.captured_at.localeCompare(b.captured_at) || a.video_id.localeCompare(b.video_id));
        const page = rows.slice(state.from ?? 0, Math.min((state.to ?? 999) + 1, (state.from ?? 0) + 1000));
        return Promise.resolve({ data: page, error: null }).then(res);
      };
      q.upsert = async (rows: Record<string, unknown>[]) => {
        upserts.push(rows);
        return { error: null };
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

describe('computeChannelOutliers', () => {
  it('uses the latest snapshot even with 100 videos x 365 snapshots', async () => {
    const upserts: Record<string, unknown>[][] = [];
    await computeChannelOutliers(fakeDb(upserts), 'c1');
    const v0 = upserts.flat().find((r) => r.video_id === 'v0');
    expect(v0).toBeDefined();
    expect(Number(v0!.score) * Number(v0!.baseline)).toBeCloseTo(999_999, 0);
  });
});
