import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runScore } from '@/lib/scoring/score-service';
import type { AlertSender } from '@/lib/email/alerts';

interface FakeOpts {
  labels?: unknown[];
  rows?: Record<string, unknown>[];
  settings?: Map<string, unknown>;
  status?: string;
}

/** Chainable fake: every query resolves to the table's fixture; `comment_labels` fails unless given. */
function fakeDb(writes: string[], opts: FakeOpts = {}) {
  const settings = opts.settings ?? new Map<string, unknown>();
  const fixtures: Record<string, unknown[]> = {
    topics: Array.from({ length: 4 }, (_, i) => ({
      id: `t${i}`,
      label: `Topic ${i}`,
      niche_id: 'n1',
      status: opts.status ?? 'active',
      niches: { rpm_coefficient: 1, owner_channel: null },
    })),
    videos: Array.from({ length: 24 }, (_, i) => ({
      id: `v${i}`,
      topic_id: `t${i % 4}`,
      channel_id: 'c1',
      // 6 videos per topic, all qualified and published in the last 72 h.
      published_at: new Date(Date.now() - 86_400_000).toISOString(),
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
    let key: string | null = null;
    const result = () =>
      table === 'comment_labels' && !opts.labels
        ? { data: null, error: { message: 'timeout' } }
        : { data: fixtures[table] ?? [], error: null };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'gte', 'lt', 'lte', 'order', 'range', 'limit', 'not', 'neq']) q[m] = () => q;
    q.eq = (_c: string, v: string) => ((key = v), q);
    q.maybeSingle = async () =>
      table === 'settings' ? { data: settings.has(key!) ? { value: settings.get(key!) } : null, error: null } : { data: null, error: null };
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    q.upsert = async (rows: Record<string, unknown>[] | { key: string; value: unknown }) => {
      writes.push(table);
      if (table === 'topic_scores') opts.rows?.push(...(rows as Record<string, unknown>[]));
      if (table === 'settings' && !Array.isArray(rows)) settings.set(rows.key, rows.value);
      return { error: null };
    };
    q.update = () => {
      writes.push(table);
      return q;
    };
    q.insert = async () => ({ error: null });
    return q;
  };
  return { from: query } as unknown as SupabaseClient;
}

const silentSender = () => {
  const sent: { kind: string }[] = [];
  return { sent, sender: { send: async (m: { kind: string }) => void sent.push(m) } as unknown as AlertSender };
};

describe('runScore read errors', () => {
  it('throws and writes no topic_scores when comment_labels fails', async () => {
    const writes: string[] = [];
    await expect(runScore(fakeDb(writes), silentSender().sender)).rejects.toThrow(/comment_labels/);
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
    await runScore(fakeDb([], { labels, rows }), silentSender().sender).catch(() => undefined);
    const t0 = rows.find((r) => r.topic_id === 't0');
    expect(t0?.frustration).toBe(1);
  });
});

describe('runScore thresholds (Réglages)', () => {
  it('phase3QualifiedIn72h = 8 prevents the burn-down alert at 6 videos', async () => {
    const settings = new Map<string, unknown>([['thresholds', { phase2TrendsGrowth: 30, phase2MaxSupply: 3, phase3QualifiedIn72h: 8 }]]);
    const { sent, sender } = silentSender();
    await runScore(fakeDb([], { labels: [], settings, status: 'in_production' }), sender).catch(() => undefined);
    expect(sent.filter((m) => m.kind === 'burn_down')).toHaveLength(0);
  });

  it('two consecutive runs send the burn-down e-mail only once', async () => {
    const settings = new Map<string, unknown>();
    const { sent, sender } = silentSender();
    await runScore(fakeDb([], { labels: [], settings, status: 'in_production' }), sender).catch(() => undefined);
    const first = sent.filter((m) => m.kind === 'burn_down').length;
    await runScore(fakeDb([], { labels: [], settings, status: 'in_production' }), sender).catch(() => undefined);
    expect(first).toBe(4);
    expect(sent.filter((m) => m.kind === 'burn_down')).toHaveLength(4);
  });

  it('6 qualified videos in 72 h put the topic in phase 3 with the default threshold (5)', async () => {
    const rows: Record<string, unknown>[] = [];
    await runScore(fakeDb([], { labels: [], rows }), silentSender().sender).catch(() => undefined);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.phase).toBe(3);
  });
});
