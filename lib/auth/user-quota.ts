/**
 * Per-account caps on server actions that spend the shared YouTube quota (used by the
 * nightly collection) or paid APIs. Counters live in `user_action_usage` (migration 00032),
 * incremented atomically by the `consume_user_quota` RPC (service role only).
 */

export type QuotaAction = 'channel_lookup' | 'link_saturation' | 'video_upload' | 'publish_check';

interface QuotaRule {
  limit: number;
  window: 'hour' | 'day';
}

export const USER_QUOTAS: Record<QuotaAction, QuotaRule> = {
  // previewMyChannel + addMyChannel + verifyMyChannel (1-2 YouTube units each)
  channel_lookup: { limit: 30, window: 'hour' },
  // checkLinkSaturation (YouTube + Voyage embeddings)
  link_saturation: { limit: 20, window: 'day' },
  // startVideoUpload (Gemini)
  video_upload: { limit: 10, window: 'day' },
  // publishAngle (YouTube videos.list)
  publish_check: { limit: 30, window: 'day' },
};

/** User-facing message (French, plain words). */
export const QUOTA_MESSAGE = 'Tu as fait beaucoup de demandes d’un coup. Réessaie un peu plus tard.';

/** Minimal shape of the Supabase client used here (keeps the helper testable). */
export interface QuotaDb {
  rpc(
    fn: 'consume_user_quota',
    args: { p_user_id: string; p_action: string; p_bucket: string; p_limit: number },
  ): PromiseLike<{ data: unknown; error: { code?: string | null; message?: string } | null }>;
}

export function quotaBucket(window: QuotaRule['window'], now: Date = new Date()): string {
  const iso = now.toISOString();
  return window === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10);
}

/** RPC or table not created yet (migration 00032 not applied). */
function isMissingQuotaSchema(error: { code?: string | null } | null): boolean {
  const code = error?.code ?? '';
  return code === 'PGRST202' || code === '42883' || code === '42P01' || code === 'PGRST205';
}

// Fallback before the migration: per-instance in-memory counters (still caps a loop).
const memoryCounters = new Map<string, number>();
const MEMORY_MAX_KEYS = 10_000;

function consumeInMemory(key: string, limit: number): boolean {
  const used = memoryCounters.get(key) ?? 0;
  if (used >= limit) return false;
  if (memoryCounters.size >= MEMORY_MAX_KEYS && !memoryCounters.has(key)) memoryCounters.clear();
  memoryCounters.set(key, used + 1);
  return true;
}

/** Test helper. */
export function resetMemoryQuotas(): void {
  memoryCounters.clear();
}

/**
 * Consumes one call for this account and action. Returns true if allowed.
 * Admins are not capped. Fails closed on unexpected DB errors; falls back to an
 * in-memory counter when the table/RPC does not exist yet.
 */
export async function consumeUserQuota(
  db: QuotaDb,
  user: { id: string; role: string },
  action: QuotaAction,
  now: Date = new Date(),
): Promise<boolean> {
  if (user.role === 'admin') return true;
  const rule = USER_QUOTAS[action];
  const bucket = quotaBucket(rule.window, now);
  const { data, error } = await db.rpc('consume_user_quota', {
    p_user_id: user.id,
    p_action: action,
    p_bucket: bucket,
    p_limit: rule.limit,
  });
  if (error) {
    if (isMissingQuotaSchema(error)) return consumeInMemory(`${user.id}|${action}|${bucket}`, rule.limit);
    return false;
  }
  return typeof data === 'number' && data <= rule.limit;
}
