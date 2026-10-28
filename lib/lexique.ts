/**
 * Displayed words shared across screens (LEXIQUE.md is the source of truth).
 * Import these instead of redefining labels per page.
 */

/** Comment label (comment_labels.label) → displayed text. */
export const COMMENT_LABELS: Record<string, string> = {
  wish_video_on: '« J’aimerais une vidéo sur… »',
  no_one_explains: '« Personne n’explique… »',
  stopped_too_early: '« La vidéo s’arrête trop tôt »',
  searched_long: '« Je cherche depuis longtemps »',
};

/** frustration (F) → displayed name. */
export const FRUSTRATION_LABEL = 'Questions sans réponse';

/** confidence → « Fiabilité (haute, moyenne, faible) ». */
export const RELIABILITY_LABELS: Record<'high' | 'medium' | 'low', string> = {
  high: 'Fiabilité haute',
  medium: 'Fiabilité moyenne',
  low: 'Fiabilité faible',
};

/** Short reliability word, for places where « Fiabilité » is already the column title. */
export const RELIABILITY_SHORT: Record<'high' | 'medium' | 'low', string> = {
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Faible',
};

/** supply_q multiplier → « ×0,4 » (French decimal), or « Aucune ». */
export function formatSupply(supplyQ: number): string {
  if (!Number.isFinite(supplyQ) || supplyQ <= 0) return 'Aucune';
  return `×${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(supplyQ)}`;
}

/** ISO date (YYYY-MM-DD or full ISO) → « 27 octobre 2026 ». */
export function formatLongDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
