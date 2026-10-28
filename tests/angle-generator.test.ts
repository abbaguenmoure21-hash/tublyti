import { afterEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
  },
}));

import { AngleGenerationError, ClaudeAngleGenerator } from '@/lib/nlp/angle-generator';

const input = {
  topicLabel: 'ETF',
  nicheName: 'Finance',
  rpmCoefficient: 1,
  phase: 2,
  frustrations: [],
  competitors: [],
};

const angle = (i: number) => ({ title: `T${i}`, hook: 'h', rationale: 'r', formula: null, frustration_resolved: null });

afterEach(() => create.mockReset());

describe('ClaudeAngleGenerator', () => {
  it('returns 5 valid angles tagged with the real model', async () => {
    create.mockResolvedValue({
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500 },
      content: [{ type: 'text', text: JSON.stringify([1, 2, 3, 4, 5].map(angle)) }],
    });
    const r = await new ClaudeAngleGenerator().generate(input);
    expect(r.angles).toHaveLength(5);
    expect(r.model).not.toMatch(/3-5|5\.5/);
    expect(create.mock.calls[0][0].model).not.toMatch(/claude-3-5/);
    expect(create.mock.calls[0][0].max_tokens).toBeLessThanOrEqual(2000);
  });

  it('truncated answer gives a clear error carrying the billed cost', async () => {
    create.mockResolvedValue({
      stop_reason: 'max_tokens',
      usage: { input_tokens: 1000, output_tokens: 2000 },
      content: [{ type: 'text', text: '[{"title": "abc", "hook": "de' }],
    });
    const err = await new ClaudeAngleGenerator().generate(input).catch((e) => e);
    expect(err).toBeInstanceOf(AngleGenerationError);
    expect(err.message).toMatch(/coupée/);
    expect(err.costUSD).toBeGreaterThan(0);
  });

  it('falls back to Haiku 4.5 when the model is unknown (404)', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('not_found'), { status: 404 })).mockResolvedValueOnce({
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 10 },
      content: [{ type: 'text', text: JSON.stringify([1, 2, 3, 4, 5].map(angle)) }],
    });
    const r = await new ClaudeAngleGenerator().generate(input);
    expect(create.mock.calls[1][0].model).toBe('claude-haiku-4-5-20251001');
    expect(r.model).toMatch(/^haiku-4-5/);
  });
});
