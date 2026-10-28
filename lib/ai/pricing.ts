/**
 * Single price table for every AI call (USD per million tokens).
 * Pure module: safe for client components (cost shown before an action).
 * Gemini prices can be overridden with GEMINI_PRICE_IN_PER_MTOK / GEMINI_PRICE_OUT_PER_MTOK.
 */

export interface Price {
  input: number;
  output: number;
}

/** Claude Haiku 4.5, standard API. */
export const HAIKU_45: Price = { input: 1.0, output: 5.0 };
/** Claude Haiku 4.5 via Batch API (-50 %). */
export const HAIKU_45_BATCH: Price = { input: 0.5, output: 2.5 };
/** Claude Sonnet (4.x), standard API. */
export const SONNET: Price = { input: 3.0, output: 15.0 };
/** Claude Opus (4.5+), standard API. */
export const OPUS: Price = { input: 5.0, output: 25.0 };

/** Gemini flash / flash-lite (prudent: audio input price). */
export function geminiPrice(): Price {
  const env = typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);
  return {
    input: Number(env.GEMINI_PRICE_IN_PER_MTOK ?? 0.5),
    output: Number(env.GEMINI_PRICE_OUT_PER_MTOK ?? 2.5),
  };
}

/** Price of a Claude model by family (unknown → Sonnet, the prudent default). */
export function claudePrice(model: string, batch = false): Price {
  if (/haiku/i.test(model)) return batch ? HAIKU_45_BATCH : HAIKU_45;
  const p = /opus/i.test(model) ? OPUS : SONNET;
  return batch ? { input: p.input / 2, output: p.output / 2 } : p;
}

export function costUsd(price: Price, tokensIn: number, tokensOut: number): number {
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}
