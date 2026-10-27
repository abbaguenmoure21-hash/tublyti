import { SupabaseClient } from '@supabase/supabase-js';
import {
  computeOutlierScore,
  type VideoInfo,
  type VideoSnapshot,
  type OutlierResult,
} from './outlier';

// ── Types ────────────────────────────────────────────────────────────

export interface OutlierServiceResult {
  computed: number;
  skipped: number;
}

// ── Service ──────────────────────────────────────────────────────────

/**
 * Compute outlier scores for all videos of a given channel and upsert into video_outliers.
 */
export async function computeChannelOutliers(
  db: SupabaseClient,
  channelId: string,
): Promise<OutlierServiceResult> {
  // 1. Get all videos for this channel, ordered by published_at desc
  const { data: videos, error: videoErr } = await db
    .from('videos')
    .select('id, channel_id, published_at')
    .eq('channel_id', channelId)
    .order('published_at', { ascending: false })
    .limit(300); // les 300 plus récentes suffisent (fenêtre d'un an + 10 vidéos de référence)

  if (videoErr) throw new Error(`Failed to fetch videos: ${videoErr.message}`);
  if (!videos || videos.length === 0) return { computed: 0, skipped: 0 };

  // 2. Snapshots de ces vidéos, par lots de 100 vidéos et par pages de 1 000 lignes.
  // Avant : une seule requête, coupée à 1 000 lignes par Supabase et triée des plus anciennes
  // aux plus récentes — les vues récentes n'étaient jamais lues et les scores restaient figés.
  const videoIds = videos.map((v: Record<string, unknown>) => v.id as string);
  const allSnapshots: { video_id: string; captured_at: string; views: number }[] = [];
  for (let i = 0; i < videoIds.length; i += 100) {
    const chunk = videoIds.slice(i, i + 100);
    for (let from = 0; from < 20_000; from += 1000) {
      const { data: page, error: snapErr } = await db
        .from('video_snapshots')
        .select('video_id, captured_at, views')
        .in('video_id', chunk)
        .order('captured_at', { ascending: true })
        .range(from, from + 999);
      if (snapErr) throw new Error(`Failed to fetch snapshots: ${snapErr.message}`);
      allSnapshots.push(...((page ?? []) as { video_id: string; captured_at: string; views: number }[]));
      if ((page ?? []).length < 1000) break;
    }
  }

  // Build snapshot map: video_id → VideoSnapshot[]
  const snapshotMap = new Map<string, VideoSnapshot[]>();
  for (const snap of allSnapshots ?? []) {
    const vid = snap.video_id as string;
    if (!snapshotMap.has(vid)) snapshotMap.set(vid, []);
    snapshotMap.get(vid)!.push({
      videoId: vid,
      capturedAt: snap.captured_at as string,
      views: Number(snap.views),
    });
  }

  // 3. Compute outlier score for each video
  const results: OutlierResult[] = [];
  const videoInfos: VideoInfo[] = videos.map((v: Record<string, unknown>) => ({
    id: v.id as string,
    channelId: v.channel_id as string,
    publishedAt: v.published_at as string,
  }));

  for (let i = 0; i < videoInfos.length; i++) {
    const video = videoInfos[i];
    const videoSnaps = snapshotMap.get(video.id) ?? [];

    // Previous videos = those published before this one (later in the desc-sorted array)
    const previousVideos = videoInfos.slice(i + 1, i + 11); // up to 10

    const result = computeOutlierScore(
      video,
      videoSnaps,
      previousVideos,
      snapshotMap,
    );

    if (result) {
      results.push(result);
    }
  }

  // 4. Upsert results into video_outliers
  if (results.length > 0) {
    const rows = results.map((r) => ({
      video_id: r.videoId,
      score: r.score,
      baseline: r.baseline,
      age_days: r.ageDays,
      method: r.method,
      computed_at: new Date().toISOString(),
    }));

    const { error: upsertErr } = await db
      .from('video_outliers')
      .upsert(rows, { onConflict: 'video_id' });

    if (upsertErr) throw new Error(`Failed to upsert outliers: ${upsertErr.message}`);
  }

  return {
    computed: results.length,
    skipped: videoInfos.length - results.length,
  };
}

/**
 * Compute outlier scores for all active channels.
 */
export async function computeAllOutliers(
  db: SupabaseClient,
): Promise<OutlierServiceResult> {
  const { data: channels, error } = await db
    .from('channels')
    .select('id')
    .eq('status', 'active');

  if (error) throw new Error(`Failed to fetch channels: ${error.message}`);

  let totalComputed = 0;
  let totalSkipped = 0;

  // 6 chaînes en parallèle (avant : une par une, la moitié du temps du calcul du potentiel).
  const ids = (channels ?? []).map((c) => c.id as string);
  const CONCURRENCY = Number(process.env.OUTLIER_CONCURRENCY ?? 6);
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const result = await computeChannelOutliers(db, id);
        totalComputed += result.computed;
        totalSkipped += result.skipped;
      } catch (e) {
        console.error(`  Outliers ${id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));

  return { computed: totalComputed, skipped: totalSkipped };
}
