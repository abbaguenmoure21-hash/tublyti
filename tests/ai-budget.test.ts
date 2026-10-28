import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addAiSpend, aiMonthKey, reserveAiBudget, settleAiBudget } from '@/lib/ai/budget';
import { AiBudgetExceeded, geminiJson } from '@/lib/ai/gemini';

/** Fake client: settings in memory + an atomic `ai_budget_add` RPC (like migration 00034). */
function fakeDb(opts: { rpc?: boolean; initial?: number } = {}) {
  const settings = new Map<string, unknown>();
  if (opts.initial !== undefined) settings.set(aiMonthKey(), opts.initial);
  const spendRows: Record<string, unknown>[] = [];
  const db = {
    settings,
    spendRows,
    async rpc(name: string, args: { p_key: string; p_delta: number; p_limit: number | null }) {
      // Yield so that parallel callers interleave, as they would over the network.
      await new Promise((r) => setTimeout(r, Math.random() * 3));
      if (!opts.rpc || name !== 'ai_budget_add') {
        return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      }
      const cur = Number(settings.get(args.p_key) ?? 0);
      if (args.p_limit !== null && args.p_delta > 0 && cur + args.p_delta > args.p_limit) return { data: null, error: null };
      const next = Math.max(0, cur + args.p_delta);
      settings.set(args.p_key, next);
      return { data: next, error: null };
    },
    from(table: string) {
      return {
        select() {
          return {
            eq(_c: string, key: string) {
              return {
                async maybeSingle() {
                  return { data: settings.has(key) ? { value: settings.get(key) } : null, error: null };
                },
              };
            },
          };
        },
        async upsert(row: { key: string; value: unknown }) {
          settings.set(row.key, row.value);
          return { error: null };
        },
        async insert(row: Record<string, unknown>) {
          if (table === 'ai_spend') spendRows.push(row);
          return { error: null };
        },
      };
    },
  };
  return db as typeof db & SupabaseClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AI budget (atomic)', () => {
  it('10 parallel additions sum exactly', async () => {
    const db = fakeDb({ rpc: true });
    const costs = Array.from({ length: 10 }, (_, i) => 0.01 * (i + 1));
    await Promise.all(costs.map((c) => addAiSpend(db, c)));
    expect(Number(db.settings.get(aiMonthKey()))).toBeCloseTo(costs.reduce((a, b) => a + b, 0), 10);
  });

  it('refuses reservations above the cap, even in parallel', async () => {
    vi.stubEnv('AI_BUDGET_USD', '1');
    const db = fakeDb({ rpc: true });
    const res = await Promise.all(Array.from({ length: 10 }, () => reserveAiBudget(db, 0.3)));
    expect(res.filter((r) => r.ok)).toHaveLength(3);
    expect(Number(db.settings.get(aiMonthKey()))).toBeCloseTo(0.9, 10);
  });

  it('settle replaces the reservation by the real cost', async () => {
    const db = fakeDb({ rpc: true });
    const r = await reserveAiBudget(db, 0.5);
    await settleAiBudget(db, r, 0.2);
    expect(Number(db.settings.get(aiMonthKey()))).toBeCloseTo(0.2, 10);
  });

  it('falls back to read/write when the RPC is missing', async () => {
    const db = fakeDb({ rpc: false, initial: 1 });
    await addAiSpend(db, 0.25);
    expect(db.settings.get(aiMonthKey())).toBeCloseTo(1.25, 10);
  });
});

describe('geminiJson budget', () => {
  it('makes no network call when the budget is exhausted', async () => {
    vi.stubEnv('AI_BUDGET_USD', '0');
    vi.stubEnv('GEMINI_API_KEY', 'test');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const db = fakeDb({ rpc: true });
    await expect(geminiJson(db, [{ text: 'hello' }], { action: 'test' })).rejects.toBeInstanceOf(AiBudgetExceeded);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts parallel calls exactly and records spend even when the JSON is invalid', async () => {
    vi.stubEnv('AI_BUDGET_USD', '100');
    vi.stubEnv('GEMINI_API_KEY', 'test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'not json' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1_000_000, candidatesTokenCount: 0 },
        }),
      })),
    );
    const db = fakeDb({ rpc: true });
    const calls = Array.from({ length: 10 }, () => geminiJson(db, [{ text: 'x' }], { action: 'test' }).catch(() => null));
    await Promise.all(calls);
    expect(db.spendRows).toHaveLength(10);
    // 1 M input tokens at $0.5 each call.
    expect(Number(db.settings.get(aiMonthKey()))).toBeCloseTo(5, 6);
  });

  it('falls back to the next model on 503', async () => {
    vi.stubEnv('AI_BUDGET_USD', '100');
    vi.stubEnv('GEMINI_API_KEY', 'test');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n += 1;
        if (n <= 2) return { ok: false, status: 503, json: async () => ({ error: { message: 'overloaded' } }) };
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }], usageMetadata: {} }),
        };
      }),
    );
    const db = fakeDb({ rpc: true });
    const p = geminiJson<{ a: number }>(db, [{ text: 'x' }], { action: 'test' });
    await vi.runAllTimersAsync();
    const out = await p;
    vi.useRealTimers();
    expect(out.data.a).toBe(1);
    expect(n).toBe(3);
  });
});
