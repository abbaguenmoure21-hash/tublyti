import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FakeYouTubeClient } from '@/lib/youtube/fake-client';

// Discovery that eats the whole window: every RSS read is slow.
const rssDelay = { ms: 0 };
vi.mock('../lib/youtube/rss', () => ({
  fetchRSSVideos: async (channelId: string) => {
    await new Promise((r) => setTimeout(r, rssDelay.ms));
    return [{ videoId: `new-${channelId}`, title: 'x', publishedAt: new Date().toISOString() }];
  },
}));

import { collectHealthError, orderSnapshotTargets, prepDeadline, runCollect } from '@/lib/youtube/collect';

const DAY = 86_400_000;

/** Minimal chainable Supabase stand-in: answers by table + selected columns, records snapshot upserts. */
function fakeDb(videos: { id: string; published_at: string }[]) {
  const written = { snapshots: 0 };
  const from = (table: string) => {
    let op = 'select';
    let cols = '';
    let rows: unknown[] = [];
    const answer = () => {
      if (op === 'upsert' && table === 'video_snapshots') written.snapshots += rows.length;
      if (op !== 'select') return { data: null, error: null };
      if (table === 'channels') return { data: Array.from({ length: 20 }, (_, i) => ({ id: `UC${i}`, uploads_playlist_id: `UU${i}`, subscriber_count: 50_000 })), error: null };
      if (table === 'videos' && cols === 'id, published_at') return { data: videos, error: null };
      return { data: [], error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const m of ['eq', 'neq', 'in', 'is', 'not', 'gte', 'lt', 'gt', 'order', 'range', 'limit']) chain[m] = () => chain;
    chain.select = (c: string) => { if (op === 'select') cols = c; return chain; };
    chain.upsert = (r: unknown) => { op = 'upsert'; rows = Array.isArray(r) ? r : [r]; return chain; };
    chain.update = () => { op = 'update'; return chain; };
    chain.insert = (r: unknown) => { op = 'insert'; rows = Array.isArray(r) ? r : [r]; return chain; };
    chain.single = async () => ({ data: null, error: null });
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej);
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, written };
}

describe('collect keeps a share of its window for view snapshots', () => {
  it('reserves max(5 min, 40 %) of the window, at most 60 %', () => {
    expect(prepDeadline(0, 20 * 60_000)).toBe(12 * 60_000); // 40 % of 20 min = 8 min
    expect(prepDeadline(0, 10 * 60_000)).toBe(5 * 60_000); // 5-min floor
    expect(prepDeadline(0, 1000)).toBe(400); // short window: 60 % cap
  });

  it('orders daily snapshots of recent videos first, newest first', () => {
    const now = new Date('2026-10-30T02:00:00Z');
    const at = (d: number) => new Date(now.getTime() - d * DAY).toISOString();
    const ids = orderSnapshotTargets(
      [
        { id: 'old', published_at: at(200) },
        { id: 'mid', published_at: at(30) },
        { id: 'new2', published_at: at(5) },
        { id: 'new1', published_at: at(1) },
      ],
      { today: new Set(), week: new Set(), month: new Set() },
      now,
    );
    expect(ids).toEqual(['new1', 'new2', 'mid', 'old']);
  });

  it('flags a collect with 0 snapshot when some were due', () => {
    expect(collectHealthError({ snapshotsDue: 10, snapshotsTaken: 0, stoppedByTimeout: true, stoppedByQuota: false })).toMatch(/0 view snapshot/);
    expect(collectHealthError({ snapshotsDue: 10, snapshotsTaken: 3, stoppedByTimeout: true, stoppedByQuota: false })).toBeNull();
    expect(collectHealthError({ snapshotsDue: 0, snapshotsTaken: 0, stoppedByTimeout: false, stoppedByQuota: false })).toBeNull();
  });

  it('when discovery eats the window, the daily snapshots are still taken', async () => {
    // 20 channels × 150 ms / 8 readers ≈ 450 ms: past the 400 ms prep share of this 1 s window.
    rssDelay.ms = 150;
    const now = Date.now();
    const videos = [
      { id: 'recent', published_at: new Date(now - DAY).toISOString() },
      { id: 'old', published_at: new Date(now - 200 * DAY).toISOString() },
    ];
    const { db, written } = fakeDb(videos);
    const r = await runCollect(db, new FakeYouTubeClient(8000), now + 1000);
    expect(r.snapshotsDue).toBe(2);
    expect(r.snapshotsTaken).toBeGreaterThan(0);
    expect(written.snapshots).toBeGreaterThan(0);
    expect(collectHealthError(r)).toBeNull();
  });
});
