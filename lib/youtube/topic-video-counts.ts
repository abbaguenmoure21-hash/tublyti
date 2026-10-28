import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk, isMissingFunction, markRpcMissing, rpcKnownMissing } from '@/lib/supabase/rpc-fallback';

/**
 * Number of catalogued videos per topic (all time, last 90 days, distinct channels over 90 days).
 *
 * Uses the `topic_video_counts` RPC (migration 00031, a single GROUP BY sent as POST).
 * Fetching every video row was capped at 1,000 rows and, with hundreds of ids, produced
 * a GET URL long enough to be rejected. Until 00031 is applied, falls back to a paginated read.
 */

export interface TopicVideoCount {
  videos: number;
  videos90d: number;
  channels90d: number;
}

const RPC = 'topic_video_counts';
const RPC_BATCH = 500;
const LEGACY_BATCH = 100;
const PAGE = 1000;

async function legacy(db: SupabaseClient, ids: string[], map: Map<string, TopicVideoCount>) {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const channels = new Map<string, Set<string>>();
  for (const batch of chunk(ids, LEGACY_BATCH)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('videos')
        .select('id, topic_id, channel_id, published_at')
        .in('topic_id', batch)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error('[topic-video-counts] legacy read failed:', error.message);
        return;
      }
      const rows = (data ?? []) as { topic_id: string; channel_id: string | null; published_at: string | null }[];
      for (const v of rows) {
        const cur = map.get(v.topic_id) ?? { videos: 0, videos90d: 0, channels90d: 0 };
        cur.videos += 1;
        if (v.published_at && v.published_at >= since) {
          cur.videos90d += 1;
          const set = channels.get(v.topic_id) ?? new Set<string>();
          if (v.channel_id) set.add(v.channel_id);
          channels.set(v.topic_id, set);
          cur.channels90d = set.size;
        }
        map.set(v.topic_id, cur);
      }
      if (rows.length < PAGE) break;
    }
  }
}

export async function getTopicVideoCounts(db: SupabaseClient, topicIds: string[]): Promise<Map<string, TopicVideoCount>> {
  const map = new Map<string, TopicVideoCount>();
  const ids = [...new Set(topicIds.filter(Boolean))];
  if (!ids.length) return map;

  if (!rpcKnownMissing(RPC)) {
    const results = await Promise.all(chunk(ids, RPC_BATCH).map((batch) => db.rpc(RPC, { p_topic_ids: batch })));
    if (!results.some((r) => isMissingFunction(r.error))) {
      for (const r of results) {
        if (r.error) console.error('[topic-video-counts] rpc failed:', r.error.message);
        for (const row of (r.data ?? []) as { topic_id: string; videos: number | string; videos_90d: number | string; channels_90d: number | string }[]) {
          map.set(row.topic_id, { videos: Number(row.videos), videos90d: Number(row.videos_90d), channels90d: Number(row.channels_90d) });
        }
      }
      return map;
    }
    markRpcMissing(RPC);
  }

  await legacy(db, ids, map);
  return map;
}
