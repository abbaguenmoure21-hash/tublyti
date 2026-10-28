import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory api_usage table with async gaps, so concurrent calls really interleave.
const rows = new Map<string, number>();
const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
const keyOf = (k: Record<string, unknown>) => `${k.token_id}|${k.tool_name}|${k.usage_date}`;

function fakeDb() {
  return {
    from() {
      return {
        upsert(row: Record<string, unknown>) {
          return (async () => {
            await tick();
            if (!rows.has(keyOf(row))) rows.set(keyOf(row), Number(row.call_count));
            return { error: null };
          })();
        },
        select() {
          return {
            match(k: Record<string, unknown>) {
              return {
                async maybeSingle() {
                  await tick();
                  const v = rows.get(keyOf(k));
                  return { data: v === undefined ? null : { call_count: v }, error: null };
                },
              };
            },
          };
        },
        update(patch: { call_count: number }) {
          return {
            match(k: Record<string, unknown>) {
              return {
                eq(_col: string, expected: number) {
                  return {
                    async select() {
                      await tick();
                      // Compare-and-swap is atomic inside the database (no await between check and write).
                      if (rows.get(keyOf(k)) !== expected) return { data: [], error: null };
                      rows.set(keyOf(k), patch.call_count);
                      return { data: [{ call_count: patch.call_count }], error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => fakeDb() }));

describe('checkRateLimit', () => {
  beforeEach(() => rows.clear());

  it('never lets more calls through than the limit under concurrency', async () => {
    const { checkRateLimit } = await import('@/lib/mcp/rate-limit');
    // analyze_video is limited to 15/day.
    const results = await Promise.all(Array.from({ length: 20 }, () => checkRateLimit('tok', 'analyze_video')));
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBeLessThanOrEqual(15);
    const counted = [...rows.values()][0];
    expect(counted).toBe(allowed);
  });

  it('allows sequential calls up to the limit, then refuses', async () => {
    const { checkRateLimit } = await import('@/lib/mcp/rate-limit');
    for (let i = 0; i < 15; i++) expect((await checkRateLimit('tok2', 'analyze_video')).allowed).toBe(true);
    const last = await checkRateLimit('tok2', 'analyze_video');
    expect(last.allowed).toBe(false);
    expect(last.error).toBeUndefined();
  });
});
