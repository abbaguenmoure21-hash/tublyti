import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Load subscriber counts for a user's channels, keyed by niche_id.
 * Used by server pages to compute per-user feasibility at display time.
 */
export async function getUserSubsByNiche(
  db: SupabaseClient,
  userId: string,
): Promise<Map<string, number>> {
  const { data } = await db
    .from('user_channels')
    .select('niche_id, subscriber_count')
    .eq('user_id', userId);
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.subscriber_count != null) {
      map.set(row.niche_id as string, row.subscriber_count as number);
    }
  }
  return map;
}
