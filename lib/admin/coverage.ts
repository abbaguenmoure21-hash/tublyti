/** Coverage rule for a niche, shared by every screen that shows it (single source of truth). */

/** Minimum videos published in the last 90 days for a niche to be well covered. */
export const MIN_VIDEOS_90D = 20_000;
export const DEFAULT_TARGET_CHANNELS = 1_500;

export function isCoverageSufficient(input: {
  channelCount: number;
  videoCount90d: number;
  targetChannels: number;
  /** Explicit flag stored on the niche (niches.coverage_sufficient), when set by a job. */
  flagged?: boolean | null;
}): boolean {
  if (input.flagged) return true;
  return input.channelCount >= input.targetChannels && input.videoCount90d >= MIN_VIDEOS_90D;
}

export function coverageGoalText(targetChannels: number): string {
  return `Objectif : ${targetChannels.toLocaleString('fr-FR')} chaînes et ${MIN_VIDEOS_90D.toLocaleString('fr-FR')} vidéos sur 90 jours`;
}

/** Local day key (Europe/Paris) "YYYY-MM-DD", so a night after midnight UTC lands on the right day. */
export function localDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

export function formatDayKey(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
}

export function isoDaysAgo(days: number, now = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString();
}
