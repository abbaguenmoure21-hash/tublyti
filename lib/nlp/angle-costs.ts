// Shared constants for angle generation cost estimation.
// This file has no server-only imports, so it's safe for client components.

// Sonnet pricing per million tokens
const INPUT_COST_PER_MTOK = 3.0;
const OUTPUT_COST_PER_MTOK = 15.0;
const EST_INPUT_TOKENS = 2000; // system + context
const EST_OUTPUT_TOKENS = 1200; // 5 angles JSON

export function estimateAngleCostUSD(): number {
  const inputCost = (EST_INPUT_TOKENS * INPUT_COST_PER_MTOK) / 1_000_000;
  const outputCost = (EST_OUTPUT_TOKENS * OUTPUT_COST_PER_MTOK) / 1_000_000;
  return inputCost + outputCost;
}
