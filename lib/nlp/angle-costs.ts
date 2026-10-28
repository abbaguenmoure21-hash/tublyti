// Shared constants for angle generation cost estimation.
// This file has no server-only imports, so it's safe for client components.
import { SONNET, costUsd } from '../ai/pricing';

const EST_INPUT_TOKENS = 2000; // system + context
const EST_OUTPUT_TOKENS = 1200; // 5 angles JSON (max_tokens = 2 000)

export function estimateAngleCostUSD(): number {
  // Prudent: priced as Sonnet (the default ANGLES_MODEL).
  return costUsd(SONNET, EST_INPUT_TOKENS, EST_OUTPUT_TOKENS);
}
