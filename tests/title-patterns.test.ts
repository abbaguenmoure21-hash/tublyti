import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const create = vi.fn(async () => ({ id: 'batch_1' }));
const retrieve = vi.fn();
const cancel = vi.fn(async () => ({}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { batches: { create, retrieve, cancel, results: vi.fn() } };
  },
}));

import { extractTitlePatterns, parsePending } from '@/lib/nlp/title-patterns';

/** Outliers: niche A has 1 200 winners above 5, niche B has 6 winners between 3 and 4. */
function fakeDb(settings: Map<string, unknown>) {
  const outliers = [
    ...Array.from({ length: 1200 }, (_, i) => ({ score: 5 + i / 100, niche: 'A', videos: { title: `A${i}`, topic_id: 'ta', topics: { niche_id: 'A' } } })),
    ...Array.from({ length: 6 }, (_, i) => ({ score: 3 + i / 10, niche: 'B', videos: { title: `B${i}`, topic_id: 'tb', topics: { niche_id: 'B' } } })),
  ];
  return {
    rpc: async () => ({ data: 1, error: null }),
    from(table: string) {
      const st: { key?: string; niche?: string; limit?: number } = {};
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'order', 'lt', 'delete']) q[m] = () => q;
      q.eq = (col: string, v: string) => {
        if (col === 'key') st.key = v;
        if (col === 'videos.topics.niche_id') st.niche = v;
        return q;
      };
      q.limit = (n: number) => ((st.limit = n), q);
      q.maybeSingle = async () => ({ data: settings.has(st.key!) ? { value: settings.get(st.key!) } : null, error: null });
      q.upsert = async (row: { key: string; value: unknown }) => {
        settings.set(row.key, row.value);
        return { error: null };
      };
      q.insert = async () => ({ error: null });
      q.then = (res: (v: unknown) => unknown) => {
        if (table === 'niches') return Promise.resolve({ data: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }], error: null }).then(res);
        if (table === 'video_outliers') {
          const rows = outliers.filter((o) => !st.niche || o.niche === st.niche).sort((a, b) => b.score - a.score);
          // PostgREST cap
          return Promise.resolve({ data: rows.slice(0, Math.min(st.limit ?? 1000, 1000)), error: null }).then(res);
        }
        return Promise.resolve({ data: [], error: null }).then(res);
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

afterEach(() => {
  create.mockClear();
  retrieve.mockReset();
  cancel.mockClear();
});

describe('extractTitlePatterns', () => {
  it('a niche with only small winners still gets its request (filtered in the database)', async () => {
    vi.stubEnv('AI_BUDGET_USD', '100');
    await extractTitlePatterns(fakeDb(new Map()));
    const calls = create.mock.calls as unknown as [{ requests: { custom_id: string }[] }][];
    const ids = calls[0][0].requests.map((r) => r.custom_id);
    expect(ids).toContain('B');
    vi.unstubAllEnvs();
  });

  it('abandons a batch pending for more than 48 h and submits again', async () => {
    vi.stubEnv('AI_BUDGET_USD', '100');
    retrieve.mockResolvedValue({ processing_status: 'in_progress' });
    const old = new Date(Date.now() - 50 * 3_600_000).toISOString();
    const settings = new Map<string, unknown>([['pending_title_pattern_batches', [{ id: 'old', at: old, est: 0.01 }]]]);
    await extractTitlePatterns(fakeDb(settings));
    expect(cancel).toHaveBeenCalledWith('old');
    expect(create).toHaveBeenCalledTimes(1);
    const pending = parsePending(settings.get('pending_title_pattern_batches'));
    expect(pending.map((p) => p.id)).toEqual(['batch_1']);
    vi.unstubAllEnvs();
  });

  it('reads the legacy pending format', () => {
    expect(parsePending(['a', { id: 'b', at: '2026-01-01', est: 0.2 }])).toEqual([
      { id: 'a', at: null, est: null },
      { id: 'b', at: '2026-01-01', est: 0.2 },
    ]);
  });
});
