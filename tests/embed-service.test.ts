import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runEmbedAll } from '@/lib/topics/embed-service';
import type { EmbeddingProvider } from '@/lib/providers/embeddings';

function fakeDb(count: number) {
  const pending = new Set(Array.from({ length: count }, (_, i) => `v${i}`));
  const stats = { selects: 0, updates: 0 };
  const db = {
    from: () => {
      let limit = 0;
      let updateId: string | null = null;
      const q = {
        select: () => q,
        is: () => q,
        not: () => q,
        order: () => q,
        limit: (n: number) => {
          limit = n;
          stats.selects++;
          return Promise.resolve({ data: [...pending].slice(0, limit).map((id) => ({ id, title: id })), error: null });
        },
        update: () => q,
        eq: (_c: string, id: string) => {
          updateId = id;
          stats.updates++;
          pending.delete(updateId);
          return Promise.resolve({ error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, stats, pending };
}

const embedder: EmbeddingProvider = {
  embed: async (texts) => texts.map(() => [0.1, 0.2]),
  dimensions: () => 2,
};

describe('runEmbedAll', () => {
  it('reads in batches of 128 (O(batches) selects)', async () => {
    const { db, stats, pending } = fakeDb(300);
    const r = await runEmbedAll(db, embedder, Date.now() + 60_000);
    expect(r.embedded).toBe(300);
    expect(pending.size).toBe(0);
    expect(stats.selects).toBe(3);
  });

  it('respects the per-night cap', async () => {
    const { db } = fakeDb(300);
    const r = await runEmbedAll(db, embedder, Date.now() + 60_000, 200);
    expect(r.embedded).toBe(200);
  });
});
