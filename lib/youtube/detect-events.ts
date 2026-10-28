import { SupabaseClient } from '@supabase/supabase-js';
import type { VideoSnapshot } from './client';

// ── Types ────────────────────────────────────────────────────────────

export interface DetectedEvent {
  videoId: string;
  eventType: 'title_change' | 'thumbnail_change' | 'spike';
  oldValue: string | null;
  newValue: string | null;
  meta?: Record<string, unknown>;
}

export interface DetectResult {
  eventsRecorded: number;
}

// ── Change detection ─────────────────────────────────────────────────

/**
 * Compare snapshot data (title, thumbnail) with stored values in `videos`.
 * Record any changes as events.
 */
export async function detectChanges(
  db: SupabaseClient,
  snapshots: VideoSnapshot[],
): Promise<DetectedEvent[]> {
  const events: DetectedEvent[] = [];
  const videoIds = snapshots
    .filter((s) => s.title || s.thumbnailUrl)
    .map((s) => s.videoId);

  if (videoIds.length === 0) return events;

  // Fetch current stored values
  const { data: storedVideos } = await db
    .from('videos')
    .select('id, title, thumbnail_url')
    .in('id', videoIds);

  const stored = new Map(
    (storedVideos ?? []).map((v: Record<string, unknown>) => [
      v.id as string,
      { title: v.title as string | null, thumbnailUrl: v.thumbnail_url as string | null },
    ]),
  );

  for (const snap of snapshots) {
    const current = stored.get(snap.videoId);
    if (!current) continue;

    // Title change
    if (snap.title && current.title && snap.title !== current.title) {
      events.push({
        videoId: snap.videoId,
        eventType: 'title_change',
        oldValue: current.title,
        newValue: snap.title,
        meta: { views_at_change: snap.views },
      });

      // Update stored title
      await db.from('videos').update({ title: snap.title }).eq('id', snap.videoId);
    }

    // Thumbnail change : YouTube garde la même adresse quand la miniature change, la vraie détection
    // se fait par empreinte d'image (étape thumb-watch). Ici on ne fait que tenir l'adresse à jour.
    if (snap.thumbnailUrl && current.thumbnailUrl && snap.thumbnailUrl !== current.thumbnailUrl) {

      // Update stored thumbnail
      await db.from('videos').update({ thumbnail_url: snap.thumbnailUrl }).eq('id', snap.videoId);
    }

    // Store thumbnail if not yet set
    if (snap.thumbnailUrl && !current.thumbnailUrl) {
      await db.from('videos').update({ thumbnail_url: snap.thumbnailUrl }).eq('id', snap.videoId);
    }
  }

  return events;
}

// ── Spike detection ──────────────────────────────────────────────────

const SPIKE_MULTIPLIER = 3;

/**
 * Detect view spikes: views per hour > 3× the median views-per-hour of the channel.
 */
export async function detectSpikes(
  db: SupabaseClient,
  snapshots: VideoSnapshot[],
): Promise<DetectedEvent[]> {
  const events: DetectedEvent[] = [];
  if (snapshots.length === 0) return events;

  const videoIds = snapshots.map((s) => s.videoId);

  // Fetch video info (channel_id, published_at)
  const { data: videos } = await db
    .from('videos')
    .select('id, channel_id, published_at')
    .in('id', videoIds);

  if (!videos || videos.length === 0) return events;

  // Group by channel
  const channelVideos = new Map<string, { videoId: string; publishedAt: string }[]>();
  const videoChannel = new Map<string, string>();
  for (const v of videos) {
    const chId = v.channel_id as string;
    videoChannel.set(v.id as string, chId);
    if (!channelVideos.has(chId)) channelVideos.set(chId, []);
    channelVideos.get(chId)!.push({ videoId: v.id as string, publishedAt: v.published_at as string });
  }

  // For each channel, compute median views-per-hour from previous snapshots
  for (const [channelId, chVideos] of channelVideos) {
    // Get recent snapshots for this channel's videos (last 2 snapshots per video)
    const chVideoIds = chVideos.map((v) => v.videoId);
    const { data: recentSnaps } = await db
      .from('video_snapshots')
      .select('video_id, captured_at, views')
      .in('video_id', chVideoIds)
      .order('captured_at', { ascending: false })
      .limit(chVideoIds.length * 3);

    if (!recentSnaps || recentSnaps.length < 2) continue;

    // Group snapshots by video, compute views-per-hour between last two snapshots
    const snapsByVideo = new Map<string, { capturedAt: string; views: number }[]>();
    for (const s of recentSnaps) {
      const vid = s.video_id as string;
      if (!snapsByVideo.has(vid)) snapsByVideo.set(vid, []);
      const arr = snapsByVideo.get(vid)!;
      if (arr.length < 3) {
        arr.push({ capturedAt: s.captured_at as string, views: Number(s.views) });
      }
    }

    // Compute VPH for each video that has ≥2 snapshots
    const allVph: number[] = [];
    for (const [, snaps] of snapsByVideo) {
      if (snaps.length < 2) continue;
      const newest = snaps[0];
      const older = snaps[1];
      const hoursDiff = (new Date(newest.capturedAt).getTime() - new Date(older.capturedAt).getTime()) / 3_600_000;
      if (hoursDiff <= 0) continue;
      const vph = (newest.views - older.views) / hoursDiff;
      if (vph > 0) allVph.push(vph);
    }

    if (allVph.length < 2) continue;

    // Median VPH
    const sorted = [...allVph].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianVph = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

    if (medianVph <= 0) continue;

    // Check current snapshots against threshold
    for (const snap of snapshots) {
      if (videoChannel.get(snap.videoId) !== channelId) continue;

      const prevSnaps = snapsByVideo.get(snap.videoId);
      if (!prevSnaps || prevSnaps.length === 0) continue;

      const prevSnap = prevSnaps[0];
      const hoursSince = (Date.now() - new Date(prevSnap.capturedAt).getTime()) / 3_600_000;
      if (hoursSince <= 0) continue;

      const currentVph = (snap.views - prevSnap.views) / hoursSince;

      if (currentVph > medianVph * SPIKE_MULTIPLIER) {
        events.push({
          videoId: snap.videoId,
          eventType: 'spike',
          oldValue: null,
          newValue: null,
          meta: {
            views_per_hour: Math.round(currentVph),
            median_vph: Math.round(medianVph),
            multiplier: Math.round((currentVph / medianVph) * 10) / 10,
            current_views: snap.views,
          },
        });
      }
    }
  }

  return dropRecentSpikes(db, events);
}

/** A video stays above the threshold for several nights: one « spike » per video every 72 h, not one per collect. */
export const SPIKE_DEDUP_HOURS = 72;

async function dropRecentSpikes(db: SupabaseClient, events: DetectedEvent[]): Promise<DetectedEvent[]> {
  if (events.length === 0) return events;
  const since = new Date(Date.now() - SPIKE_DEDUP_HOURS * 3_600_000).toISOString();
  const { data, error } = await db
    .from('video_events')
    .select('video_id')
    .eq('event_type', 'spike')
    .in('video_id', [...new Set(events.map((e) => e.videoId))])
    .gte('created_at', since);
  if (error) {
    console.error(`spike dedup: ${error.message}`);
    return events;
  }
  const recent = new Set((data ?? []).map((r) => (r as { video_id: string }).video_id));
  return events.filter((e) => !recent.has(e.videoId));
}

// ── Record events to DB ──────────────────────────────────────────────

export async function recordEvents(
  db: SupabaseClient,
  events: DetectedEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const rows = events.map((e) => ({
    workspace_id: '00000000-0000-0000-0000-000000000001',
    video_id: e.videoId,
    event_type: e.eventType,
    old_value: e.oldValue,
    new_value: e.newValue,
    meta: e.meta ?? null,
  }));

  const { error } = await db.from('video_events').insert(rows);
  if (error) {
    console.error('Failed to record events:', error.message);
    return 0;
  }

  return rows.length;
}

/**
 * Record new_upload events for newly discovered videos.
 */
export async function recordNewUploads(
  db: SupabaseClient,
  videoIds: string[],
): Promise<number> {
  if (videoIds.length === 0) return 0;

  const rows = videoIds.map((id) => ({
    workspace_id: '00000000-0000-0000-0000-000000000001',
    video_id: id,
    event_type: 'new_upload',
    old_value: null,
    new_value: null,
    meta: null,
  }));

  const { error } = await db.from('video_events').insert(rows);
  if (error) {
    console.error('Failed to record new uploads:', error.message);
    return 0;
  }

  return rows.length;
}
