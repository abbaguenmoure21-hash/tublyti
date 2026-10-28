import { SupabaseClient } from '@supabase/supabase-js';
import type { YouTubeClient } from './client';
import { QuotaSoftLimitReached, getQuotaSoftLimit } from './quota';
import { fetchRSSVideos } from './rss';
import { detectChanges, detectSpikes, recordEvents, recordNewUploads } from './detect-events';

const SUBSCRIBER_THRESHOLD = 10000;
const DURATION_THRESHOLD = 480;
const VIEW_RATIO_THRESHOLD = 0.2;

const MIN_COMMENT_LENGTH = 15;
const COMMENT_MAX_PAGES = 5;

export interface CollectResult {
  channelsUpdated: number;
  videosDiscovered: number;
  videosFromRSS: number;
  videosFromAPI: number;
  snapshotsTaken: number;
  commentsImported: number;
  commentsPurged: number;
  eventsRecorded: number;
  quotaUsed: number;
  stoppedByQuota: boolean;
  stoppedByTimeout: boolean;
}

/**
 * Quota budget envelope — each task has a max allocation.
 * Falls back to percentage of soft limit if no quota_plan is configured.
 */
interface QuotaBudget {
  tracking: number;
  comments: number;
}

async function loadQuotaBudget(db: SupabaseClient, softLimit: number): Promise<QuotaBudget> {
  const { data } = await db
    .from('settings')
    .select('value')
    .eq('key', 'quota_plan')
    .single();

  if (data?.value && typeof data.value === 'object') {
    const plan = data.value as Record<string, number>;
    return {
      tracking: plan.tracking ?? Math.floor(softLimit * 0.45),
      comments: plan.comments ?? Math.floor(softLimit * 0.25),
    };
  }

  // Default: 45% tracking, 25% comments (rest for search/discovery)
  return {
    tracking: Math.floor(softLimit * 0.45),
    comments: Math.floor(softLimit * 0.25),
  };
}

export async function runCollect(
  db: SupabaseClient,
  yt: YouTubeClient,
  deadlineMs: number,
): Promise<CollectResult> {
  const result: CollectResult = {
    channelsUpdated: 0,
    videosDiscovered: 0,
    videosFromRSS: 0,
    videosFromAPI: 0,
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

  const budget = await loadQuotaBudget(db, getQuotaSoftLimit());
  let trackingQuota = 0;
  let commentQuota = 0;

  const logStep = (name: string, t0: number) =>
    console.log(`    [collect] ${name} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  try {
    // ── Step 1: Update channels (oldest first) ──────────────────────
    const t1 = Date.now();
    const { data: channels } = await db
      .from('channels')
      .select('id, uploads_playlist_id, subscriber_count')
      .neq('status', 'paused') // chaînes mises en pause : plus suivies
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
      trackingQuota += 1;

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

    logStep('channel-updates', t1);

    if (result.stoppedByTimeout) {
      result.quotaUsed = yt.getQuotaUsed();
      return result;
    }

    // ── Step 2: Discover new videos — RSS first, API fallback ────────
    const t2 = Date.now();
    const { data: updatedChannels } = await db
      .from('channels')
      .select('id, uploads_playlist_id, subscriber_count')
      .not('uploads_playlist_id', 'is', null)
      .neq('status', 'paused')
      .order('last_checked_at', { ascending: true, nullsFirst: true });

    for (const channel of updatedChannels ?? []) {
      if (isTimedOut()) {
        result.stoppedByTimeout = true;
        break;
      }

      let videoIds: string[] = [];
      let usedRSS = false;

      // Try RSS first (0 quota units)
      try {
        const rssEntries = await fetchRSSVideos(channel.id);
        if (rssEntries.length > 0) {
          videoIds = rssEntries.map((e) => e.videoId);
          usedRSS = true;
        }
      } catch {
        // RSS failed — fall through to API
      }

      // Fallback to playlistItems.list (1 quota unit)
      if (!usedRSS && channel.uploads_playlist_id) {
        if (trackingQuota >= budget.tracking) {
          result.stoppedByQuota = true;
          break;
        }
        try {
          videoIds = await yt.getPlaylistItems(channel.uploads_playlist_id, 50);
          trackingQuota += 1;
        } catch (err) {
          if (err instanceof QuotaSoftLimitReached) throw err;
          console.error(`Skipping channel ${channel.id}: ${(err as Error).message}`);
          continue;
        }
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

      // Fetch video details via API (need duration, thumbnails)
      if (trackingQuota >= budget.tracking) {
        result.stoppedByQuota = true;
        break;
      }
      const videos = await yt.getVideos(newIds);
      trackingQuota += Math.ceil(newIds.length / 50);

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
        if (usedRSS) result.videosFromRSS++;
        else result.videosFromAPI++;
      }

      // Record new_upload events
      if (newIds.length > 0) {
        const recorded = await recordNewUploads(db, newIds);
        result.eventsRecorded += recorded;
      }
    }

    logStep('video-discovery', t2);

    if (result.stoppedByTimeout || result.stoppedByQuota) {
      result.quotaUsed = yt.getQuotaUsed();
      return result;
    }

    // ── Step 3: Tiered snapshots ─────────────────────────────────────
    const t3 = Date.now();
    // Daily for <14 days, weekly for 14-90 days, monthly for >90 days
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Paginated fetch of all videos (Supabase caps at 1000 per query)
    const allVideos: { id: string; published_at: string }[] = [];
    {
      let vOffset = 0;
      while (true) {
        const { data: batch } = await db
          .from('videos')
          .select('id, published_at')
          .range(vOffset, vOffset + 999);
        if (!batch?.length) break;
        allVideos.push(...batch);
        if (batch.length < 1000) break;
        vOffset += batch.length;
      }
    }

    // Paginated fetch of recent snapshot video_ids
    const hasSnapToday = new Set<string>();
    const hasSnapThisWeek = new Set<string>();
    const hasSnapThisMonth = new Set<string>();
    {
      let sOffset = 0;
      while (true) {
        const { data: batch } = await db
          .from('video_snapshots')
          .select('video_id, captured_at')
          .gte('captured_at', thirtyDaysAgo.toISOString())
          .range(sOffset, sOffset + 999);
        if (!batch?.length) break;
        for (const s of batch) {
          const ca = new Date(s.captured_at);
          if (ca >= todayStart) hasSnapToday.add(s.video_id);
          if (ca >= sevenDaysAgo) hasSnapThisWeek.add(s.video_id);
          hasSnapThisMonth.add(s.video_id);
        }
        if (batch.length < 1000) break;
        sOffset += batch.length;
      }
    }

    const snapshotIds: string[] = [];
    for (const v of allVideos ?? []) {
      const pubDate = new Date(v.published_at);

      if (pubDate >= fourteenDaysAgo) {
        // Very recent: daily snapshots
        if (!hasSnapToday.has(v.id)) snapshotIds.push(v.id);
      } else if (pubDate >= ninetyDaysAgo) {
        // Medium: weekly snapshots
        if (!hasSnapThisWeek.has(v.id)) snapshotIds.push(v.id);
      } else {
        // Old: monthly snapshots
        if (!hasSnapThisMonth.has(v.id)) snapshotIds.push(v.id);
      }
    }

    for (let i = 0; i < snapshotIds.length; i += 50) {
      if (isTimedOut()) {
        result.stoppedByTimeout = true;
        break;
      }
      if (trackingQuota >= budget.tracking) {
        result.stoppedByQuota = true;
        break;
      }

      const batch = snapshotIds.slice(i, i + 50);
      const snapshots = await yt.getVideoSnapshots(batch);
      trackingQuota += 1;

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

      // Update is_qualified with view ratio
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

    logStep('tiered-snapshots', t3);

    if (result.stoppedByTimeout || result.stoppedByQuota) {
      result.quotaUsed = yt.getQuotaUsed();
      return result;
    }

    // Commentaires : étape de nuit séparée (runCommentIngestion), avec son propre temps et son quota.
    // Avant, ils arrivaient en fin de collecte et étaient sautés dès que la collecte manquait de temps.
  } catch (err) {
    if (err instanceof QuotaSoftLimitReached) {
      result.stoppedByQuota = true;
    } else {
      throw err;
    }
  }

  result.quotaUsed = yt.getQuotaUsed();

  // Record quota usage by task for the day
  await db.from('settings').upsert({
    key: `quota_${new Date().toISOString().slice(0, 10)}`,
    value: { tracking: trackingQuota, comments: commentQuota, total: result.quotaUsed },
  });

  return result;
}


export interface CommentIngestionResult {
  videosChecked: number;
  commentsImported: number;
  commentsPurged: number;
  quotaUsed: number;
  stoppedByQuota: boolean;
  stoppedByTimeout: boolean;
}

/**
 * Collecte des commentaires (étape de nuit « comments »).
 * Vidéos longues (≥ 8 min) d'au moins 10 000 vues, rattachées à un sujet publié, dont les commentaires
 * n'ont pas été lus depuis 7 jours ; sujets en phase 0 à 2 d'abord, puis les plus vues.
 * Coût : COMMENT_MAX_PAGES unités par vidéo au plus (commentThreads.list), dans la limite du budget « comments ».
 */
export async function runCommentIngestion(
  db: SupabaseClient,
  yt: YouTubeClient,
  deadlineMs: number,
): Promise<CommentIngestionResult> {
  const res: CommentIngestionResult = { videosChecked: 0, commentsImported: 0, commentsPurged: 0, quotaUsed: 0, stoppedByQuota: false, stoppedByTimeout: false };
  const budget = await loadQuotaBudget(db, getQuotaSoftLimit());
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const quotaStart = yt.getQuotaUsed();

  // Vidéos candidates, par pages de 1 000 (limite de Supabase), au plus 5 000.
  const candidates: { id: string; phase: number | null }[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await db
      .from('videos')
      .select('id, topics!inner(phase, status)')
      .not('topic_id', 'is', null)
      .gte('duration_s', DURATION_THRESHOLD)
      .in('topics.status', ['active', 'in_production'])
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(from, from + 999);
    if (error) throw new Error(`commentaires, sélection des vidéos : ${error.message}`);
    for (const v of (data ?? []) as unknown as { id: string; topics: { phase: number | null } | null }[]) {
      candidates.push({ id: v.id, phase: v.topics?.phase ?? null });
    }
    if ((data ?? []).length < 1000) break;
  }

  // Vues et date du dernier commentaire lu, par lots de 150 (les longues listes d'identifiants échouent).
  const views = new Map<string, number>();
  const lastComment = new Map<string, string>();
  for (let k = 0; k < candidates.length; k += 150) {
    const ids = candidates.slice(k, k + 150).map((c) => c.id);
    const [snaps, comments] = await Promise.all([
      db.from('video_snapshots').select('video_id, views, captured_at').in('video_id', ids).order('captured_at', { ascending: false }).limit(2000),
      db.from('comments').select('video_id, published_at').in('video_id', ids).order('published_at', { ascending: false }).limit(2000),
    ]);
    for (const sn of (snaps.data ?? []) as { video_id: string; views: number | null }[]) {
      if (!views.has(sn.video_id)) views.set(sn.video_id, sn.views ?? 0);
    }
    for (const cm of (comments.data ?? []) as { video_id: string; published_at: string }[]) {
      if (!lastComment.has(cm.video_id)) lastComment.set(cm.video_id, cm.published_at);
    }
  }

  const todo = candidates
    .map((c) => ({ ...c, views: views.get(c.id) ?? 0 }))
    .filter((c) => c.views >= 10_000 && !((lastComment.get(c.id) ?? '') >= sevenDaysAgo))
    .sort((a, b) => {
      const aP = a.phase !== null && a.phase <= 2 ? a.phase : 99;
      const bP = b.phase !== null && b.phase <= 2 ? b.phase : 99;
      return aP !== bP ? aP - bP : b.views - a.views;
    });
  console.log(`    [comments] ${candidates.length} vidéos rattachées, ${todo.length} à lire (≥ 10 000 vues, pas lues depuis 7 jours)`);

  let commentQuota = 0;
  try {
    for (const video of todo) {
      if (Date.now() >= deadlineMs) {
        res.stoppedByTimeout = true;
        break;
      }
      if (commentQuota >= budget.comments) {
        res.stoppedByQuota = true;
        break;
      }
      res.videosChecked++;
      try {
        const comments = await yt.getCommentThreads(video.id, 100, COMMENT_MAX_PAGES);
        commentQuota += COMMENT_MAX_PAGES;
        const rows = comments
          .filter((c) => c.text.length >= MIN_COMMENT_LENGTH)
          .map((c) => ({
            id: c.id,
            workspace_id: '00000000-0000-0000-0000-000000000001',
            video_id: c.videoId,
            text: c.text,
            like_count: c.likeCount,
            published_at: c.publishedAt,
          }));
        if (rows.length) {
          const { error } = await db.from('comments').upsert(rows, { onConflict: 'id' });
          if (!error) res.commentsImported += rows.length;
        }
      } catch (err) {
        if (err instanceof QuotaSoftLimitReached) throw err;
        // Commentaires désactivés sur la vidéo, vidéo supprimée… : on passe à la suivante.
        console.error(`    [comments] ${video.id} : ${(err as Error).message}`);
      }
    }

    // Purge des commentaires de plus de 90 jours déjà classés
    const { data: purgeTargets } = await db
      .from('comments')
      .select('id, comment_labels(comment_id)')
      .lt('published_at', ninetyDaysAgo)
      .limit(5000);
    const purgeIds = ((purgeTargets ?? []) as { id: string; comment_labels: { comment_id: string }[] | null }[])
      .filter((c) => (c.comment_labels ?? []).length > 0)
      .map((c) => c.id);
    for (let k = 0; k < purgeIds.length; k += 200) {
      const { error } = await db.from('comments').delete().in('id', purgeIds.slice(k, k + 200));
      if (!error) res.commentsPurged += Math.min(200, purgeIds.length - k);
    }
  } catch (err) {
    if (err instanceof QuotaSoftLimitReached) res.stoppedByQuota = true;
    else throw err;
  }

  res.quotaUsed = yt.getQuotaUsed() - quotaStart;
  return res;
}
