import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk, isMissingFunction, markRpcMissing, rpcKnownMissing } from '@/lib/supabase/rpc-fallback';

/**
 * Latest snapshot (views, likes, comments) of each video.
 *
 * Uses the `latest_video_snapshots` RPC (migration 00031: one row per video, served by the
 * primary key). Reading every snapshot of N videos and de-duplicating in JS was silently
 * truncated by PostgREST at 1,000 rows. Until 00031 is applied, falls back to a paginated read.
 */

export interface LatestSnapshot {
  views: number | null;
  likes: number | null;
  comments: number | null;
  capturedAt: string;
}

interface SnapshotRow {
  video_id: string;
  captured_at: string;
  views: number | string | null;
  likes: number | string | null;
  comments: number | string | null;
}

const RPC = 'latest_video_snapshots';
const RPC_BATCH = 500; // one row per id, well under the 1,000-row cap
const LEGACY_BATCH = 100; // keeps the GET URL short
const PAGE = 1000;

const num = (x: number | string | null): number | null => (x == null ? null : Number(x));

function put(map: Map<string, LatestSnapshot>, r: SnapshotRow) {
  if (map.has(r.video_id)) return;
  map.set(r.video_id, { views: num(r.views), likes: num(r.likes), comments: num(r.comments), capturedAt: r.captured_at });
}

async function legacy(db: SupabaseClient, ids: string[], map: Map<string, LatestSnapshot>) {
  for (const batch of chunk(ids, LEGACY_BATCH)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('video_snapshots')
        .select('video_id, captured_at, views, likes, comments')
        .in('video_id', batch)
        .order('captured_at', { ascending: false })
        .order('video_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error('[latest-snapshots] legacy read failed:', error.message);
        return;
      }
      const rows = (data ?? []) as SnapshotRow[];
      for (const r of rows) put(map, r);
      if (rows.length < PAGE || batch.every((id) => map.has(id))) break;
    }
  }
}

export async function getLatestSnapshots(db: SupabaseClient, videoIds: string[]): Promise<Map<string, LatestSnapshot>> {
  const map = new Map<string, LatestSnapshot>();
  const ids = [...new Set(videoIds.filter(Boolean))];
  if (!ids.length) return map;

  if (!rpcKnownMissing(RPC)) {
    const results = await Promise.all(chunk(ids, RPC_BATCH).map((batch) => db.rpc(RPC, { p_video_ids: batch })));
    const missing = results.find((r) => isMissingFunction(r.error));
    if (!missing) {
      for (const r of results) {
        if (r.error) console.error('[latest-snapshots] rpc failed:', r.error.message);
        for (const row of (r.data ?? []) as SnapshotRow[]) put(map, row);
      }
      return map;
    }
    markRpcMissing(RPC);
  }

  await legacy(db, ids, map);
  return map;
}
