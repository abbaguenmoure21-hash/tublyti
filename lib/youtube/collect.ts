import { SupabaseClient } from '@supabase/supabase-js';
import type { YouTubeClient } from './client';
import { QuotaSoftLimitReached } from './quota';

const SUBSCRIBER_THRESHOLD = 10000;
const DURATION_THRESHOLD = 480;
const VIEW_RATIO_THRESHOLD = 0.2;

export interface CollectResult {
  channelsUpdated: number;
  videosDiscovered: number;
  snapshotsTaken: number;
  quotaUsed: number;
  stoppedByQuota: boolean;
  stoppedByTimeout: boolean;
}

export async function runCollect(
  db: SupabaseClient,
  yt: YouTubeClient,
  deadlineMs: number,
): Promise<CollectResult> {
  const result: CollectResult = {
    channelsUpdated: 0,
    videosDiscovered: 0,
    snapshotsTaken: 0,
    quotaUsed: 0,
    stoppedByQuota: false,
    stoppedByTimeout: false,
  };

  function isTimedOut() {
    return Date.now() >= deadlineMs;
  }

  try {
    // ── Step 1: Update channels (oldest first) ──────────────────────
    const { data: channels } = await db
      .from('channels')
      .select('id, uploads_playlist_id, subscriber_count')
      .order('last_checked_at', { ascending: true, nullsFirst: true });

    if (!channels || channels.length === 0) return result;

    // Update channel info in batches of 50
    for (let i = 0; i < channels.length; i += 50) {
      if (isTimedOut()) {
        result.stoppedByTimeout = true;
        break;
      }

      const batch = channels.slice(i, i + 50);
      const ids = batch.map((c) => c.id);
      const infos = await yt.getChannels(ids);

      for (const info of infos) {
        await db
          .from('channels')
          .update({
            title: info.title,
            subscriber_count: info.subscriberCount,
            uploads_playlist_id: info.uploadsPlaylistId,
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', info.id);
        result.channelsUpdated++;
      }
    }

    if (result.stoppedByTimeout) {
      result.quotaUsed = yt.getQuotaUsed();
      return result;
    }

    // ── Step 2: Discover new videos via uploads playlist ────────────
    // Re-fetch channels with updated uploads_playlist_id
    const { data: updatedChannels } = await db
      .from('channels')
      .select('id, uploads_playlist_id, subscriber_count')
      .not('uploads_playlist_id', 'is', null)
      .order('last_checked_at', { ascending: true, nullsFirst: true });

    for (const channel of updatedChannels ?? []) {
      if (isTimedOut()) {
        result.stoppedByTimeout = true;
        break;
      }

      const videoIds = await yt.getPlaylistItems(channel.uploads_playlist_id, 50);
      if (videoIds.length === 0) continue;

      // Check which videos are already known
      const { data: existing } = await db
        .from('videos')
        .select('id')
        .in('id', videoIds);
      const existingIds = new Set((existing ?? []).map((v) => v.id));
      const newIds = videoIds.filter((id) => !existingIds.has(id));

      if (newIds.length === 0) continue;

      // Fetch video details
      const videos = await yt.getVideos(newIds);

      for (const video of videos) {
        const isQualified =
          video.durationSeconds >= DURATION_THRESHOLD &&
          (channel.subscriber_count ?? 0) >= SUBSCRIBER_THRESHOLD;

        await db.from('videos').upsert({
          id: video.id,
          workspace_id: '00000000-0000-0000-0000-000000000001',
          channel_id: video.channelId,
          title: video.title,
          published_at: video.publishedAt,
          duration_s: video.durationSeconds,
          is_qualified: isQualified,
        });
        result.videosDiscovered++;
      }
    }

    if (result.stoppedByTimeout) {
      result.quotaUsed = yt.getQuotaUsed();
      return result;
    }

    // ── Step 3: Snapshots ───────────────────────────────────────────
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Daily snapshots for videos < 90 days old
    const { data: recentVideos } = await db
      .from('videos')
      .select('id')
      .gte('published_at', ninetyDaysAgo.toISOString());

    // Weekly snapshots for older videos (only if no snapshot this week)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { data: olderVideos } = await db
      .from('videos')
      .select('id')
      .lt('published_at', ninetyDaysAgo.toISOString());

    // Filter older videos that don't have a recent snapshot
    const olderIds: string[] = [];
    for (const v of olderVideos ?? []) {
      const { data: snap } = await db
        .from('video_snapshots')
        .select('video_id')
        .eq('video_id', v.id)
        .gte('captured_at', sevenDaysAgo.toISOString())
        .limit(1);
      if (!snap || snap.length === 0) {
        olderIds.push(v.id);
      }
    }

    const allSnapshotIds = [
      ...(recentVideos ?? []).map((v) => v.id),
      ...olderIds,
    ];

    for (let i = 0; i < allSnapshotIds.length; i += 50) {
      if (isTimedOut()) {
        result.stoppedByTimeout = true;
        break;
      }

      const batch = allSnapshotIds.slice(i, i + 50);
      const snapshots = await yt.getVideoSnapshots(batch);

      for (const snap of snapshots) {
        await db.from('video_snapshots').upsert(
          {
            video_id: snap.videoId,
            captured_at: now.toISOString(),
            views: snap.views,
            likes: snap.likes,
            comments: snap.comments,
          },
          { onConflict: 'video_id,captured_at' },
        );
        result.snapshotsTaken++;
      }

      // Update is_qualified with view ratio if we have subscriber data
      for (const snap of snapshots) {
        const { data: video } = await db
          .from('videos')
          .select('channel_id, duration_s')
          .eq('id', snap.videoId)
          .single();
        if (!video) continue;

        const { data: channel } = await db
          .from('channels')
          .select('subscriber_count')
          .eq('id', video.channel_id)
          .single();
        if (!channel || !channel.subscriber_count) continue;

        const viewRatio = snap.views / channel.subscriber_count;
        const isQualified =
          (video.duration_s ?? 0) >= DURATION_THRESHOLD &&
          channel.subscriber_count >= SUBSCRIBER_THRESHOLD &&
          viewRatio >= VIEW_RATIO_THRESHOLD;

        await db.from('videos').update({ is_qualified: isQualified }).eq('id', snap.videoId);
      }
    }
  } catch (err) {
    if (err instanceof QuotaSoftLimitReached) {
      result.stoppedByQuota = true;
    } else {
      throw err;
    }
  }

  result.quotaUsed = yt.getQuotaUsed();
  return result;
}
