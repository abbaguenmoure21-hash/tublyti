/**
 * MGI sequential scale mapped to theme tokens (--mgi-1 … --mgi-5 in globals.css).
 * The scoring layer still returns the reference hex values; components translate
 * them to CSS variables so the scale follows the light/dark theme.
 * Use these colors for gauges and bars only, never for text.
 */
export type MgiTier = 1 | 2 | 3 | 4 | 5;

const HEX_TO_TIER: Record<string, MgiTier> = {
  '#e2e6ff': 1,
  '#b7c0f8': 2,
  '#8c97e9': 3,
  '#646cd8': 4,
  '#443cc6': 5,
};

export function mgiTierVar(tier: MgiTier): string {
  return `var(--mgi-${tier})`;
}

/** Translate a scale hex (from lib/scoring) into its theme token; unknown values pass through. */
export function mgiColor(hex: string): string {
  const tier = HEX_TO_TIER[hex.toLowerCase()];
  return tier ? mgiTierVar(tier) : hex;
}

/** The five steps, weakest first. */
export const MGI_SCALE: string[] = ([1, 2, 3, 4, 5] as const).map(mgiTierVar);
