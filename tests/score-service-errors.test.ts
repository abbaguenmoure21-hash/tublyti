import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runScore } from '@/lib/scoring/score-service';
import type { AlertSender } from '@/lib/email/alerts';

/** Chainable fake: every query resolves to the table's fixture; `comment_labels` fails. */
function fakeDb(writes: string[], opts: { labels?: unknown[]; rows?: Record<string, unknown>[] } = {}) {
  const fixtures: Record<string, unknown[]> = {
    topics: Array.from({ length: 4 }, (_, i) => ({
      id: `t${i}`,
      label: `Topic ${i}`,
      niche_id: 'n1',
      status: 'active',
      niches: { rpm_coefficient: 1, owner_channel: null },
    })),
    videos: Array.from({ length: 24 }, (_, i) => ({
      id: `v${i}`,
      topic_id: `t${i % 4}`,
      channel_id: 'c1',
      published_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      duration_s: 900,
      is_qualified: true,
    })),
    channels: [{ id: 'c1', subscriber_count: 50_000 }],
    video_snapshots: [],
    video_outliers: [],
    comments: Array.from({ length: 24 }, (_, i) => ({ id: `cm${i}`, video_id: `v${i}`, like_count: 1 })),
    comment_labels: opts.labels ?? [],
  };
  const query = (table: string) => {
    const result =
      table === 'comment_labels' && !opts.labels
        ? { data: null, error: { message: 'timeout' } }
        : { data: fixtures[table] ?? [], error: null };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'eq', 'gte', 'lt', 'lte', 'order', 'range', 'limit', 'not']) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    q.upsert = async (rows: Record<string, unknown>[]) => {
      writes.push(table);
      if (table === 'topic_scores') opts.rows?.push(...rows);
      return { error: null };
    };
    q.update = () => {
      writes.push(table);
      return q;
    };
    return q;
  };
  return { from: query } as unknown as SupabaseClient;
}

describe('runScore read errors', () => {
  it('throws and writes no topic_scores when comment_labels fails', async () => {
    const writes: string[] = [];
    const sender = { send: async () => undefined } as unknown as AlertSender;
    await expect(runScore(fakeDb(writes), sender)).rejects.toThrow(/comment_labels/);
    expect(writes).not.toContain('topic_scores');
  });

  it('unreadable labels do not dilute frustration', async () => {
    const rows: Record<string, unknown>[] = [];
    // Topic t0 has videos v0, v4, v8... : one real frustration + unreadable ones.
    const labels = [
      { comment_id: 'cm0', label: 'wish_video_on', confidence: 0.9, model: 'haiku-4.5-classify_v1' },
      { comment_id: 'cm4', label: 'none', confidence: 0, model: 'haiku-4.5-classify_v1-unparsable' },
      { comment_id: 'cm8', label: 'none', confidence: 0, model: 'haiku-4.5-classify_v1-unparsable' },
    ];
    const sender = { send: async () => undefined } as unknown as AlertSender;
    await runScore(fakeDb([], { labels, rows }), sender).catch(() => undefined);
    const t0 = rows.find((r) => r.topic_id === 't0');
    expect(t0?.frustration).toBe(1);
  });
});
