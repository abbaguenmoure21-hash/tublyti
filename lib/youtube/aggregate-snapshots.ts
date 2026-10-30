/**
 * Compact video_snapshots older than the cutoff into video_stats_weekly rows, then delete them.
 * video_snapshots has NO `id` column: its key is (video_id, captured_at).
 *
 * Uses the SQL function aggregate_old_snapshots (migration 00033: one transaction per batch);
 * falls back to an equivalent client-side path while the migration is not applied.
 * A week split across two batches is merged with the existing weekly row (max values, summed count).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AggregateResult {
  weeklyRows: number;
  deleted: number;
  mode: 'rpc' | 'fallback';
  stoppedByTimeout: boolean;
}

interface SnapRow {
  video_id: string;
  captured_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

interface WeekRow {
  video_id: string;
  week_start: string;
  views: number;
  likes: number;
  comments: number;
  snapshots_count: number;
}

export function isoWeekStart(d: Date): string {
  const day = d.getUTCDay();
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/** Pure: group snapshots by (video, ISO week), merged with already-aggregated weeks. */
export function mergeWeekly(snaps: SnapRow[], existing: WeekRow[]): WeekRow[] {
  const map = new Map<string, WeekRow>();
  for (const e of existing) map.set(`${e.video_id}::${e.week_start}`, { ...e });
  for (const s of snaps) {
    const ws = isoWeekStart(new Date(s.captured_at));
    const key = `${s.video_id}::${ws}`;
    const cur = map.get(key);
    if (cur) {
      cur.views = Math.max(cur.views, s.views ?? 0);
      cur.likes = Math.max(cur.likes, s.likes ?? 0);
      cur.comments = Math.max(cur.comments, s.comments ?? 0);
      cur.snapshots_count += 1;
    } else {
      map.set(key, { video_id: s.video_id, week_start: ws, views: s.views ?? 0, likes: s.likes ?? 0, comments: s.comments ?? 0, snapshots_count: 1 });
    }
  }
  return [...map.values()];
}

const BATCH = 1000;

async function fallbackBatch(db: SupabaseClient, cutoff: string): Promise<{ weekly: number; deleted: number; full: boolean }> {
  const { data, error } = await db
    .from('video_snapshots')
    .select('video_id, captured_at, views, likes, comments')
    .lt('captured_at', cutoff)
    .order('captured_at', { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`aggregate: read snapshots: ${error.message}`);
  const snaps = (data ?? []) as SnapRow[];
  if (snaps.length === 0) return { weekly: 0, deleted: 0, full: false };

  const videoIds = [...new Set(snaps.map((s) => s.video_id))];
  const weeks = [...new Set(snaps.map((s) => isoWeekStart(new Date(s.captured_at))))];
  const existing: WeekRow[] = [];
  for (let i = 0; i < videoIds.length; i += 150) {
    const { data: ex, error: exErr } = await db
      .from('video_stats_weekly')
      .select('video_id, week_start, views, likes, comments, snapshots_count')
      .in('video_id', videoIds.slice(i, i + 150))
      .in('week_start', weeks);
    if (exErr) throw new Error(`aggregate: read weekly: ${exErr.message}`);
    existing.push(...((ex ?? []) as WeekRow[]));
  }

  // Only the weeks touched by this batch (existing rows of other weeks are left alone).
  const touched = new Set(snaps.map((s) => `${s.video_id}::${isoWeekStart(new Date(s.captured_at))}`));
  const rows = mergeWeekly(snaps, existing).filter((r) => touched.has(`${r.video_id}::${r.week_start}`));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: upErr } = await db.from('video_stats_weekly').upsert(rows.slice(i, i + 500), { onConflict: 'video_id,week_start' });
    if (upErr) throw new Error(`aggregate: upsert weekly: ${upErr.message}`);
  }

  // Delete by key (video_id, captured_at), grouped per video.
  const byVideo = new Map<string, string[]>();
  for (const s of snaps) {
    const list = byVideo.get(s.video_id) ?? [];
    list.push(s.captured_at);
    byVideo.set(s.video_id, list);
  }
  let deleted = 0;
  for (const [videoId, dates] of byVideo) {
    const { error: delErr } = await db.from('video_snapshots').delete().eq('video_id', videoId).in('captured_at', dates);
    if (delErr) throw new Error(`aggregate: delete snapshots: ${delErr.message}`);
    deleted += dates.length;
  }
  return { weekly: rows.length, deleted, full: snaps.length === BATCH };
}

export async function aggregateOldSnapshots(db: SupabaseClient, cutoffDate: Date, deadlineMs: number): Promise<AggregateResult> {
  const cutoff = cutoffDate.toISOString();
  const res: AggregateResult = { weeklyRows: 0, deleted: 0, mode: 'rpc', stoppedByTimeout: false };
  let useRpc = true;

  while (true) {
    if (Date.now() >= deadlineMs) {
      res.stoppedByTimeout = true;
      break;
    }
    if (useRpc) {
      const { data, error } = await db.rpc('aggregate_old_snapshots', { p_cutoff: cutoff, p_limit: 5000 });
      if (error) {
        // Function missing (migration 00033 not applied): client-side path.
        console.warn(`  [aggregate] aggregate_old_snapshots unavailable (${error.message}) — client-side fallback`);
        useRpc = false;
        res.mode = 'fallback';
        continue;
      }
      const row = (Array.isArray(data) ? data[0] : data) as { weekly_rows?: number; deleted_rows?: number } | null;
      const deleted = row?.deleted_rows ?? 0;
      res.weeklyRows += row?.weekly_rows ?? 0;
      res.deleted += deleted;
      if (deleted < 5000) break;
    } else {
      const b = await fallbackBatch(db, cutoff);
      res.weeklyRows += b.weekly;
      res.deleted += b.deleted;
      if (!b.full) break;
    }
  }
  return res;
}
