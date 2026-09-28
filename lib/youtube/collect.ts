import { SupabaseClient } from '@supabase/supabase-js';
import type { YouTubeClient } from './client';
import { QuotaSoftLimitReached } from './quota';
import { detectChanges, detectSpikes, recordEvents, recordNewUploads } from './detect-events';

const SUBSCRIBER_THRESHOLD = 10000;
const DURATION_THRESHOLD = 480;
const VIEW_RATIO_THRESHOLD = 0.2;

const MIN_COMMENT_LENGTH = 15;
const COMMENT_MAX_PAGES = 5;

export interface CollectResult {
  channelsUpdated: number;
  videosDiscovered: number;
  snapshotsTaken: number;
  commentsImported: number;
  commentsPurged: number;
  eventsRecorded: number;
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
    commentsImported: 0,
    commentsPurged: 0,
    eventsRecorded: 0,
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

      if (!channel.uploads_playlist_id) continue;

      let videoIds: string[];
      try {
        videoIds = await yt.getPlaylistItems(channel.uploads_playlist_id, 50);
      } catch (err) {
        if (err instanceof QuotaSoftLimitReached) throw err;
        console.error(`Skipping channel ${channel.id}: ${(err as Error).message}`);
        continue;
      }
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
          thumbnail_url: video.thumbnailUrl,
          is_qualified: isQualified,
        });
        result.videosDiscovered++;
      }

      // Record new_upload events
      if (newIds.length > 0) {
        const recorded = await recordNewUploads(db, newIds);
        result.eventsRecorded += recorded;
      }
    }

    if (result.stoppedByTimeout) {
      result.quotaUsed = yt.getQuotaUsed();
      return result;
    }

    // ── Step 3: Snapshots ───────────────────────────────────────────
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // Daily snapshots for recent videos, weekly for older ones
    // Only include videos that don't already have a snapshot in the current period
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);

    const { data: allVideos } = await db
      .from('videos')
      .select('id, published_at');

    // Batch-fetch all recent snapshots to filter in memory
    const allVideoIds = (allVideos ?? []).map((v) => v.id);
    const { data: todaySnaps } = await db
      .from('video_snapshots')
      .select('video_id')
      .in('video_id', allVideoIds)
      .gte('captured_at', todayStart.toISOString());
    const hasSnapToday = new Set((todaySnaps ?? []).map((s) => s.video_id));

    const { data: weekSnaps } = await db
      .from('video_snapshots')
      .select('video_id')
      .in('video_id', allVideoIds)
      .gte('captured_at', sevenDaysAgo.toISOString());
    const hasSnapThisWeek = new Set((weekSnaps ?? []).map((s) => s.video_id));

    const allSnapshotIds: string[] = [];
    for (const v of allVideos ?? []) {
      const isRecent = new Date(v.published_at) >= ninetyDaysAgo;
      if (isRecent && !hasSnapToday.has(v.id)) {
        allSnapshotIds.push(v.id);
      } else if (!isRecent && !hasSnapThisWeek.has(v.id)) {
        allSnapshotIds.push(v.id);
      }
    }

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

      // Detect title/thumbnail changes and view spikes
      const [changeEvents, spikeEvents] = await Promise.all([
        detectChanges(db, snapshots),
        detectSpikes(db, snapshots),
      ]);
      const allEvents = [...changeEvents, ...spikeEvents];
      if (allEvents.length > 0) {
        const recorded = await recordEvents(db, allEvents);
        result.eventsRecorded += recorded;
      }

      // Update is_qualified with view ratio — batch-fetch video & channel data
      const snapVideoIds = snapshots.map((s) => s.videoId);
      const { data: batchVideos } = await db
        .from('videos')
        .select('id, channel_id, duration_s')
        .in('id', snapVideoIds);
      const videoMap = new Map((batchVideos ?? []).map((v) => [v.id, v]));

      const channelIds = [...new Set((batchVideos ?? []).map((v) => v.channel_id))];
      const { data: batchChannels } = await db
        .from('channels')
        .select('id, subscriber_count')
        .in('id', channelIds);
      const channelMap = new Map((batchChannels ?? []).map((c) => [c.id, c]));

      for (const snap of snapshots) {
        const video = videoMap.get(snap.videoId);
        if (!video) continue;
        const channel = channelMap.get(video.channel_id);
        if (!channel || !channel.subscriber_count) continue;

        const viewRatio = snap.views / channel.subscriber_count;
        const isQualified =
          (video.duration_s ?? 0) >= DURATION_THRESHOLD &&
          channel.subscriber_count >= SUBSCRIBER_THRESHOLD &&
          viewRatio >= VIEW_RATIO_THRESHOLD;

        await db.from('videos').update({ is_qualified: isQualified }).eq('id', snap.videoId);
      }
    }
    if (result.stoppedByTimeout) {
      result.quotaUsed = yt.getQuotaUsed();
      return result;
    }

    // ── Step 4: Comment ingestion ─────────────────────────────────
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoForComments = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Videos < 60 days, prioritized: phase 0/1/2 topics first, then by views
    const { data: commentCandidates } = await db
      .from('videos')
      .select(`
        id,
        topic_id,
        topics(phase),
        video_snapshots(views)
      `)
      .gte('published_at', sixtyDaysAgo.toISOString());

    // Find videos that need comments (no comments yet, or last import > 7 days)
    const videosNeedingComments: { id: string; phase: number | null; views: number }[] = [];

    for (const v of commentCandidates ?? []) {
      const { data: latestComment } = await db
        .from('comments')
        .select('published_at')
        .eq('video_id', v.id)
        .order('published_at', { ascending: false })
        .limit(1);

      // Skip if we imported comments recently (check by looking at any comment)
      if (latestComment && latestComment.length > 0) {
        // Use a simple heuristic: if the newest comment fetch was recent, skip
        const { count } = await db
          .from('comments')
          .select('id', { count: 'exact', head: true })
          .eq('video_id', v.id)
          .gte('published_at', sevenDaysAgoForComments.toISOString());

        // If we already have recent comments, skip this video
        if (count && count > 0) continue;
      }

      const topicsData = v.topics as unknown as { phase: number | null } | null;
      const phase = topicsData?.phase ?? null;
      const snaps = v.video_snapshots as unknown as { views: number }[] | null;
      const views = snaps?.[0]?.views ?? 0;

      videosNeedingComments.push({ id: v.id, phase, views });
    }

    // Sort: phase 0/1/2 first (by phase asc), then by views desc
    videosNeedingComments.sort((a, b) => {
      const aP = a.phase !== null && a.phase <= 2 ? a.phase : 99;
      const bP = b.phase !== null && b.phase <= 2 ? b.phase : 99;
      if (aP !== bP) return aP - bP;
      return b.views - a.views;
    });

    for (const video of videosNeedingComments) {
      if (isTimedOut()) {
        result.stoppedByTimeout = true;
        break;
      }

      try {
        const comments = await yt.getCommentThreads(video.id, 100, COMMENT_MAX_PAGES);

        for (const comment of comments) {
          // Skip short comments and replies (we only have top-level from API)
          if (comment.text.length < MIN_COMMENT_LENGTH) continue;

          const { error } = await db.from('comments').upsert(
            {
              id: comment.id,
              workspace_id: '00000000-0000-0000-0000-000000000001',
              video_id: comment.videoId,
              text: comment.text,
              like_count: comment.likeCount,
              published_at: comment.publishedAt,
            },
            { onConflict: 'id' },
          );
          if (!error) result.commentsImported++;
        }
      } catch (err) {
        if (err instanceof QuotaSoftLimitReached) throw err;
        // Comments disabled or other API error — skip this video
        console.error(`Skipping comments for video ${video.id}: ${(err as Error).message}`);
        continue;
      }
    }

    if (result.stoppedByTimeout) {
      result.quotaUsed = yt.getQuotaUsed();
      return result;
    }

    // ── Step 5: Purge old comments (>90 days) that already have labels ─
    const { data: purgeTargets } = await db
      .from('comments')
      .select('id, comment_labels(comment_id)')
      .lt('published_at', ninetyDaysAgo.toISOString());

    for (const comment of purgeTargets ?? []) {
      const labels = comment.comment_labels as { comment_id: string }[] | null;
      if (labels && labels.length > 0) {
        await db.from('comments').delete().eq('id', comment.id);
        result.commentsPurged++;
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
