import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingFunction, markRpcMissing, rpcKnownMissing } from '@/lib/supabase/rpc-fallback';

/**
 * Cumulated thumbnail impressions and clicks (impressions × CTR) per video of a connected channel.
 *
 * Uses the `video_reach_totals` RPC (migration 00031, SUM in SQL). Reading the daily rows was
 * capped at 1,000 rows, so totals were under-counted after ~40 days of history.
 * Until 00031 is applied, falls back to a paginated read.
 */

export interface ReachTotal {
  impressions: number;
  clicks: number;
}

const RPC = 'video_reach_totals';
const PAGE = 1000;

/**
 * @param range optional day window (YYYY-MM-DD, inclusive). The RPC sums all history, so a window
 * is read from the daily rows (paginated); `firstDay` then reports the first day actually covered.
 */
export async function getVideoReachTotals(
  db: SupabaseClient,
  userChannelId: string,
  videoIds: string[],
  range?: { from: string; to: string; onFirstDay?: (day: string | null) => void },
): Promise<Map<string, ReachTotal>> {
  const map = new Map<string, ReachTotal>();
  const ids = [...new Set(videoIds.filter(Boolean))];
  if (!ids.length) {
    range?.onFirstDay?.(null);
    return map;
  }

  if (!range && !rpcKnownMissing(RPC)) {
    const { data, error } = await db.rpc(RPC, { p_user_channel_id: userChannelId, p_video_ids: ids });
    if (!error) {
      for (const r of (data ?? []) as { video_id: string; impressions: number | string | null; clicks: number | string | null }[]) {
        map.set(r.video_id, { impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0 });
      }
      return map;
    }
    // Missing function, timeout, revoked EXECUTE…: fall back to the paginated read, never an empty result.
    if (isMissingFunction(error)) markRpcMissing(RPC);
    else console.error('[reach-totals] rpc failed, using paginated read:', error.message);
  }

  let firstDay: string | null = null;
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from('video_reach_daily')
      .select('video_id, day, impressions, ctr')
      .eq('user_channel_id', userChannelId)
      .in('video_id', ids);
    if (range) q = q.gte('day', range.from).lte('day', range.to);
    const { data, error } = await q
      .order('video_id', { ascending: true })
      .order('day', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[reach-totals] legacy read failed:', error.message);
      break;
    }
    const rows = (data ?? []) as { video_id: string; day: string; impressions: number | null; ctr: number | null }[];
    for (const r of rows) {
      if (!firstDay || r.day < firstDay) firstDay = r.day;
      const cur = map.get(r.video_id) ?? { impressions: 0, clicks: 0 };
      const imp = Number(r.impressions) || 0;
      cur.impressions += imp;
      cur.clicks += imp * (Number(r.ctr) || 0);
      map.set(r.video_id, cur);
    }
    if (rows.length < PAGE) break;
  }
  range?.onFirstDay?.(firstDay);
  return map;
}
