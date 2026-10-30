import { beforeEach, describe, expect, it, vi } from 'vitest';

const reserveAiBudget = vi.fn();
const settleAiBudget = vi.fn<(...a: unknown[]) => Promise<void>>(async () => undefined);
vi.mock('@/lib/ai/budget', () => ({
  reserveAiBudget: (...a: unknown[]) => reserveAiBudget(...a),
  settleAiBudget: (...a: unknown[]) => settleAiBudget(...a),
}));
vi.mock('../lib/ai/budget', () => ({
  reserveAiBudget: (...a: unknown[]) => reserveAiBudget(...a),
  settleAiBudget: (...a: unknown[]) => settleAiBudget(...a),
}));

const { nameTopicWithHaiku } = await import('@/lib/topics/cluster-service');

const inserts: unknown[] = [];
const db = { from: () => ({ insert: async (row: unknown) => { inserts.push(row); return { error: null }; } }) } as never;

function fakeAnthropic(reply: string, usage = { input_tokens: 500, output_tokens: 80 }) {
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: reply }], usage }));
  return { client: { messages: { create } } as never, create };
}

const titles = ['How ETFs really work', 'ETF basics', 'Why ETFs beat stock picking'];

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
});

describe('nameTopicWithHaiku budget (FINAL #3)', () => {
  it('reserves the budget before calling Haiku and settles the real cost', async () => {
    reserveAiBudget.mockResolvedValue({ ok: true, reservedUsd: 0.0016, remainingUsd: 10 });
    const { client, create } = fakeAnthropic('{"label":"etf basics","queries":["etf","etf basics","index funds"]}');
    const r = await nameTopicWithHaiku(db, titles, 'Finance', { anthropic: client });
    expect(reserveAiBudget).toHaveBeenCalledTimes(1);
    expect(reserveAiBudget.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
    expect(r?.label).toBe('etf basics');
    // 500 in × $1/M + 80 out × $5/M = $0.0009
    expect(settleAiBudget).toHaveBeenCalledWith(db, expect.objectContaining({ ok: true }), expect.closeTo(0.0009, 6));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ action: 'name_topic', tokens_in: 500, tokens_out: 80 });
  });

  it('skips the call when the monthly budget is spent and falls back to the shortest title', async () => {
    reserveAiBudget.mockResolvedValue({ ok: false, reservedUsd: 0, remainingUsd: 0 });
    const { client, create } = fakeAnthropic('{}');
    const r = await nameTopicWithHaiku(db, titles, 'Finance', { anthropic: client });
    expect(create).not.toHaveBeenCalled();
    expect(r).toEqual({ label: 'ETF basics', queries: ['etf basics'] });
    expect(settleAiBudget).not.toHaveBeenCalled();
  });

  it('skips the call when the budget cannot be checked (fail closed)', async () => {
    reserveAiBudget.mockRejectedValue(new Error('db down'));
    const { client, create } = fakeAnthropic('{}');
    const r = await nameTopicWithHaiku(db, titles, 'Finance', { anthropic: client });
    expect(create).not.toHaveBeenCalled();
    expect(r?.label).toBe('ETF basics');
  });

  it('refunds the reservation when the call fails', async () => {
    reserveAiBudget.mockResolvedValue({ ok: true, reservedUsd: 0.0016, remainingUsd: 10 });
    const create = vi.fn(async () => {
      throw new Error('overloaded');
    });
    const r = await nameTopicWithHaiku(db, titles, 'Finance', { anthropic: { messages: { create } } as never });
    expect(r?.label).toBe('ETF basics');
    expect(settleAiBudget).toHaveBeenCalledWith(db, expect.objectContaining({ ok: true }), 0);
  });

  it('keeps the billed cost when the answer is not valid JSON', async () => {
    reserveAiBudget.mockResolvedValue({ ok: true, reservedUsd: 0.0016, remainingUsd: 10 });
    const { client } = fakeAnthropic('not json');
    await nameTopicWithHaiku(db, titles, 'Finance', { anthropic: client });
    expect(settleAiBudget).toHaveBeenCalledTimes(1);
    expect(settleAiBudget.mock.calls[0][2]).toBeGreaterThan(0);
  });
});
