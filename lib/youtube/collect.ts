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
// Parallel RSS readers (no quota; same model as thumb-watch).
const RSS_CONCURRENCY = 8;

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
  /** Videos that needed a view snapshot tonight (daily < 14 d, weekly < 90 d, monthly beyond). */
  snapshotsDue: number;
}

/**
 * Share of the collect window reserved for view snapshots (priority n° 1): channel updates and video
 * discovery stop at `end − max(5 min, 40 %)` (at most 60 % of the window), snapshots get the rest.
 */
export function prepDeadline(startMs: number, deadlineMs: number): number {
  const windowMs = Math.max(0, deadlineMs - startMs);
  const reserve = Math.min(windowMs * 0.6, Math.max(5 * 60_000, windowMs * 0.4));
  return deadlineMs - reserve;
}

/** Snapshot targets, most useful first: daily (< 14 d), then weekly (< 90 d), then monthly. */
export function orderSnapshotTargets(
  videos: { id: string; published_at: string }[],
  has: { today: Set<string>; week: Set<string>; month: Set<string> },
  now: Date,
): string[] {
  const d14 = now.getTime() - 14 * 86_400_000;
  const d90 = now.getTime() - 90 * 86_400_000;
  const daily: { id: string; t: number }[] = [];
  const weekly: string[] = [];
  const monthly: string[] = [];
  for (const v of videos) {
    const t = new Date(v.published_at).getTime();
    if (t >= d14) { if (!has.today.has(v.id)) daily.push({ id: v.id, t }); }
    else if (t >= d90) { if (!has.week.has(v.id)) weekly.push(v.id); }
    else if (!has.month.has(v.id)) monthly.push(v.id);
  }
  daily.sort((a, b) => b.t - a.t); // newest first
  return [...daily.map((d) => d.id), ...weekly, ...monthly];
}

/** Error to raise when the collect produced no view snapshot although some were due (null = healthy). */
export function collectHealthError(r: Pick<CollectResult, 'snapshotsTaken' | 'snapshotsDue' | 'stoppedByTimeout' | 'stoppedByQuota'>): string | null {
  if (r.snapshotsDue > 0 && r.snapshotsTaken === 0) {
    const why = r.stoppedByQuota ? 'quota budget' : r.stoppedByTimeout ? 'time' : 'unknown reason';
    return `collect: 0 view snapshot taken out of ${r.snapshotsDue} due (stopped by ${why})`;
  }
  return null;
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

/** Read every row (Supabase caps a select at 1 000); a read error is raised, never treated as « nothing ». */
async function fetchAllRows<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`collect, ${label} : ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
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
    snapshotsDue: 0,
  };

  function isTimedOut() {
    return Date.now() >= deadlineMs;
  }
  // Channel updates + discovery must leave the reserved share to the snapshots.
  const prepEnd = prepDeadline(Date.now(), deadlineMs);
  let prepStopped = false;
  function isPrepTimedOut() {
    if (Date.now() >= prepEnd) { prepStopped = true; return true; }
    return false;
  }

  const budget = await loadQuotaBudget(db, getQuotaSoftLimit());
  let trackingQuota = 0;

  const logStep = (name: string, t0: number) =>
    console.log(`    [collect] ${name} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  try {
    // ── Step 1: Update channels (oldest first) ──────────────────────
    const t1 = Date.now();
    // Chaînes mises en pause : plus suivies. Une erreur de lecture fait échouer l'étape (avant : « 0 chaîne », job réussi).
    const channels = await fetchAllRows<{ id: string; uploads_playlist_id: string | null; subscriber_count: number | null }>(
      'lecture des chaînes',
      (from, to) => db
        .from('channels')
        .select('id, uploads_playlist_id, subscriber_count')
        .neq('status', 'paused')
        .order('last_checked_at', { ascending: true, nullsFirst: true })
        .order('id')
        .range(from, to),
    );

    if (channels.length === 0) {
      console.warn('    [collect] aucune chaîne suivie');
      return result;
    }

    // Update channel info in batches of 50
    for (let i = 0; i < channels.length; i += 50) {
      if (isPrepTimedOut()) break;

      const batch = channels.slice(i, i + 50);
      const ids = batch.map((c) => c.id);
      const infos = await yt.getChannels(ids);
      trackingQuota += 1;

      // Updates in parallel (10 at a time) instead of one round-trip after the other.
      for (let k = 0; k < infos.length; k += 10) {
        const updates = await Promise.all(infos.slice(k, k + 10).map((info) => db
          .from('channels')
          .update({
            title: info.title,
            subscriber_count: info.subscriberCount,
            uploads_playlist_id: info.uploadsPlaylistId,
            last_checked_at: new Date().toISOString(),
          })
          .eq('id', info.id)));
        for (const u of updates) {
          if (u.error) console.error(`    [collect] channel update: ${u.error.message}`);
          else result.channelsUpdated++;
        }
      }
    }

    logStep('channel-updates', t1);
    // No early return on lack of time any more: the snapshots always get their reserved share.

    // ── Step 2: Discover new videos — RSS first, API fallback ────────
    const t2 = Date.now();
    const updatedChannels = await fetchAllRows<{ id: string; uploads_playlist_id: string | null; subscriber_count: number | null }>(
      'lecture des chaînes à jour',
      (from, to) => db
        .from('channels')
        .select('id, uploads_playlist_id, subscriber_count')
        .not('uploads_playlist_id', 'is', null)
        .neq('status', 'paused')
        .order('last_checked_at', { ascending: true, nullsFirst: true })
        .order('id')
        .range(from, to),
    );

    // 2a. RSS in parallel (0 quota, network-bound): RSS_CONCURRENCY readers instead of one channel after the other.
    const channelById = new Map(updatedChannels.map((c) => [c.id, c]));
    const sourceOf = new Map<string, 'rss' | 'api'>(); // videoId → how it was found
    const videoChannel = new Map<string, string>(); // videoId → followed channel
    const rssFailed: typeof updatedChannels = [];
    {
      let next = 0;
      const worker = async () => {
        while (next < updatedChannels.length) {
          if (isPrepTimedOut()) return;
          const channel = updatedChannels[next++]!;
          try {
            const entries = await fetchRSSVideos(channel.id);
            if (entries.length === 0) { rssFailed.push(channel); continue; }
            for (const e of entries) {
              sourceOf.set(e.videoId, 'rss');
              videoChannel.set(e.videoId, channel.id);
            }
          } catch {
            rssFailed.push(channel); // RSS failed — API fallback below
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(RSS_CONCURRENCY, updatedChannels.length) }, worker));
    }

    // 2b. API fallback (playlistItems.list, 1 unit) for channels whose feed failed.
    for (const channel of rssFailed) {
      if (isPrepTimedOut()) break;
      if (!channel.uploads_playlist_id) continue;
      if (trackingQuota >= budget.tracking) { result.stoppedByQuota = true; break; }
      try {
        const ids = await yt.getPlaylistItems(channel.uploads_playlist_id, 50);
        trackingQuota += 1;
        for (const id of ids) {
          if (!sourceOf.has(id)) sourceOf.set(id, 'api');
          videoChannel.set(id, channel.id);
        }
      } catch (err) {
        if (err instanceof QuotaSoftLimitReached) throw err;
        console.error(`Skipping channel ${channel.id}: ${(err as Error).message}`);
      }
    }

    // 2c. Unknown videos of all channels together, details by 50 (was one videos.list per channel, often for 1-2 videos).
    const candidateIds = [...videoChannel.keys()];
    const newIds: string[] = [];
    for (let i = 0; i < candidateIds.length; i += 150) {
      const chunk = candidateIds.slice(i, i + 150);
      const { data: existing, error: existingErr } = await db.from('videos').select('id').in('id', chunk);
      if (existingErr) throw new Error(`collect, vidéos connues : ${existingErr.message}`);
      const known = new Set((existing ?? []).map((v) => v.id as string));
      for (const id of chunk) if (!known.has(id)) newIds.push(id);
    }

    for (let i = 0; i < newIds.length; i += 50) {
      if (isPrepTimedOut()) break;
      if (trackingQuota >= budget.tracking) { result.stoppedByQuota = true; break; }
      const batch = newIds.slice(i, i + 50);
      const videos = await yt.getVideos(batch);
      trackingQuota += 1;

      const videoRows = videos.map((video) => {
        const followed = channelById.get(videoChannel.get(video.id) ?? video.channelId);
        return {
          id: video.id,
          workspace_id: '00000000-0000-0000-0000-000000000001',
          channel_id: video.channelId,
          title: video.title,
          published_at: video.publishedAt,
          duration_s: video.durationSeconds,
          thumbnail_url: video.thumbnailUrl,
          is_qualified:
            video.durationSeconds >= DURATION_THRESHOLD &&
            (followed?.subscriber_count ?? 0) >= SUBSCRIBER_THRESHOLD,
        };
      });
      if (videoRows.length === 0) continue;
      const { error: upErr } = await db.from('videos').upsert(videoRows);
      if (upErr) {
        console.error(`    [collect] videos upsert: ${upErr.message}`);
        continue;
      }
      result.videosDiscovered += videoRows.length;
      for (const r of videoRows) {
        if (sourceOf.get(r.id) === 'api') result.videosFromAPI++;
        else result.videosFromRSS++;
      }
      // Record new_upload events (only for rows actually written: video_events references videos)
      result.eventsRecorded += await recordNewUploads(db, videoRows.map((r) => r.id));
    }
    console.log(`    [collect] ${updatedChannels.length} channels, RSS failed ${rssFailed.length}, ${newIds.length} new videos`);

    logStep('video-discovery', t2);
    if (prepStopped) console.log('    [collect] channel updates / discovery cut short to keep the snapshot share');

    // ── Step 3: Tiered snapshots ─────────────────────────────────────
    const t3 = Date.now();
    // Daily for <14 days, weekly for 14-90 days, monthly for >90 days (orderSnapshotTargets)
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Paginated fetch of all videos (Supabase caps at 1000 per query)
    const allVideos: { id: string; published_at: string }[] = [];
    {
      let vOffset = 0;
      while (true) {
        const { data: batch, error: vErr } = await db
          .from('videos')
          .select('id, published_at')
          .order('id')
          .range(vOffset, vOffset + 999);
        if (vErr) throw new Error(`collect, lecture des vidéos : ${vErr.message}`);
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
        const { data: batch, error: sErr } = await db
          .from('video_snapshots')
          .select('video_id, captured_at')
          .gte('captured_at', thirtyDaysAgo.toISOString())
          .order('video_id')
          .order('captured_at')
          .range(sOffset, sOffset + 999);
        if (sErr) throw new Error(`collect, lecture des relevés : ${sErr.message}`);
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

    // Daily snapshots of recent videos first: when time runs out, the least useful ones are cut.
    const snapshotIds = orderSnapshotTargets(allVideos, { today: hasSnapToday, week: hasSnapThisWeek, month: hasSnapThisMonth }, now);
    result.snapshotsDue = snapshotIds.length;

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

      // One upsert per batch of 50 (was one round-trip per video).
      if (snapshots.length > 0) {
        const { error: snapErr } = await db.from('video_snapshots').upsert(
          snapshots.map((snap) => ({
            video_id: snap.videoId,
            captured_at: now.toISOString(),
            views: snap.views,
            likes: snap.likes,
            comments: snap.comments,
          })),
          { onConflict: 'video_id,captured_at' },
        );
        if (snapErr) throw new Error(`collect, enregistrement des relevés : ${snapErr.message}`);
        result.snapshotsTaken += snapshots.length;
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

      // Two updates per batch (qualified / not qualified) instead of one per video.
      const qualified: string[] = [];
      const notQualified: string[] = [];
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
        (isQualified ? qualified : notQualified).push(snap.videoId);
      }
      for (const [ids, value] of [[qualified, true], [notQualified, false]] as const) {
        if (ids.length === 0) continue;
        const { error: qErr } = await db.from('videos').update({ is_qualified: value }).in('id', ids);
        if (qErr) console.error(`    [collect] is_qualified update: ${qErr.message}`);
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
  // Daily quota by task: persisted by the nightly's process-wide ledger (yt_quota_ledger), no longer in settings.
  console.log(`    [collect] tracking quota ${trackingQuota}/${budget.tracking}`);

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
  // comments_fetched_at / comments_disabled (migration 00033) : date de dernière LECTURE ; repli sans elles.
  let hasFetchedCol = true;
  const candidates: { id: string; phase: number | null; fetchedAt: string | null; disabled: boolean }[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const query = (cols: string) => db
      .from('videos')
      .select(cols)
      .not('topic_id', 'is', null)
      .gte('duration_s', DURATION_THRESHOLD)
      .in('topics.status', ['active', 'in_production'])
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(from, from + 999);
    let { data, error } = await query(hasFetchedCol
      ? 'id, comments_fetched_at, comments_disabled, topics!inner(phase, status)'
      : 'id, topics!inner(phase, status)');
    if (error && hasFetchedCol && /comments_fetched_at|comments_disabled/.test(error.message)) {
      console.warn('    [comments] videos.comments_fetched_at absent (migration 00033) — repli sur la date du dernier commentaire');
      hasFetchedCol = false;
      ({ data, error } = await query('id, topics!inner(phase, status)'));
    }
    if (error) throw new Error(`commentaires, sélection des vidéos : ${error.message}`);
    const rows = (data ?? []) as unknown as { id: string; comments_fetched_at?: string | null; comments_disabled?: boolean | null; topics: { phase: number | null } | null }[];
    for (const v of rows) {
      candidates.push({ id: v.id, phase: v.topics?.phase ?? null, fetchedAt: v.comments_fetched_at ?? null, disabled: Boolean(v.comments_disabled) });
    }
    if (rows.length < 1000) break;
  }

  // Dernières vues par vidéo, par lots de 50 sur 35 jours (après compactage, il n'y a pas plus vieux) :
  // l'ancien `.limit(2000)` sur 150 vidéos tronquait des vidéos à 0 vue, hors sélection sans message.
  const thirtyFiveDaysAgo = new Date(now.getTime() - 35 * 86_400_000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const views = new Map<string, number>();
  const lastComment = new Map<string, string>();
  for (let k = 0; k < candidates.length; k += 50) {
    const ids = candidates.slice(k, k + 50).map((c) => c.id);
    const [snaps, comments] = await Promise.all([
      db.from('video_snapshots').select('video_id, views, captured_at').in('video_id', ids).gte('captured_at', thirtyFiveDaysAgo).order('captured_at', { ascending: false }).limit(5000),
      hasFetchedCol
        ? Promise.resolve({ data: [] as { video_id: string; published_at: string }[], error: null })
        : db.from('comments').select('video_id, published_at').in('video_id', ids).order('published_at', { ascending: false }).limit(5000),
    ]);
    if (snaps.error) throw new Error(`commentaires, lecture des vues : ${snaps.error.message}`);
    for (const sn of (snaps.data ?? []) as { video_id: string; views: number | null }[]) {
      if (!views.has(sn.video_id)) views.set(sn.video_id, sn.views ?? 0);
    }
    for (const cm of (comments.data ?? []) as { video_id: string; published_at: string }[]) {
      if (!lastComment.has(cm.video_id)) lastComment.set(cm.video_id, cm.published_at);
    }
  }

  const recentlyRead = (c: { id: string; fetchedAt: string | null; disabled: boolean }) =>
    hasFetchedCol
      ? (c.fetchedAt !== null && c.fetchedAt >= (c.disabled ? thirtyDaysAgo : sevenDaysAgo))
      : (lastComment.get(c.id) ?? '') >= sevenDaysAgo;
  const todo = candidates
    .map((c) => ({ ...c, views: views.get(c.id) ?? 0 }))
    .filter((c) => c.views >= 10_000 && !recentlyRead(c))
    .sort((a, b) => {
      const aP = a.phase !== null && a.phase <= 2 ? a.phase : 99;
      const bP = b.phase !== null && b.phase <= 2 ? b.phase : 99;
      return aP !== bP ? aP - bP : b.views - a.views;
    });
  console.log(`    [comments] ${candidates.length} vidéos rattachées, ${todo.length} à lire (≥ 10 000 vues, pas lues depuis 7 jours)`);

  const markFetched = async (videoId: string, disabled: boolean) => {
    if (!hasFetchedCol) return;
    const { error } = await db.from('videos').update({ comments_fetched_at: new Date().toISOString(), comments_disabled: disabled }).eq('id', videoId);
    if (error) console.error(`    [comments] ${videoId} : date de lecture non enregistrée (${error.message})`);
  };

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
        const before = yt.getQuotaUsed();
        let comments;
        try {
          comments = await yt.getCommentThreads(video.id, 100, COMMENT_MAX_PAGES);
        } finally {
          // Real cost (pages actually read), not COMMENT_MAX_PAGES.
          commentQuota += Math.max(0, yt.getQuotaUsed() - before);
        }
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
          else console.error(`    [comments] ${video.id} : enregistrement impossible (${error.message})`);
        }
        await markFetched(video.id, false);
      } catch (err) {
        if (err instanceof QuotaSoftLimitReached) throw err;
        // Commentaires désactivés sur la vidéo, vidéo supprimée… : on passe à la suivante, sans la relire demain.
        const msg = (err as Error).message;
        console.error(`    [comments] ${video.id} : ${msg}`);
        if (/commentsDisabled|videoNotFound| 403| 404/.test(msg)) await markFetched(video.id, true);
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
