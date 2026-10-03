import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getLatestScoreDate } from '@/lib/scoring/latest-score-date';
import { handleCors, jsonWithCors } from '@/lib/ext/cors';
import { authenticateExtRequest, isAuthError } from '@/lib/ext/auth';
import { canSeeNiche } from '@/lib/mcp/auth';
import { RealYouTubeClient } from '@/lib/youtube/client';
import { escapeLike } from '@/lib/utils';

const bodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('video'), id: z.string().min(1) }),
  z.object({ type: z.literal('channel'), id: z.string().min(1) }),
  z.object({ type: z.literal('search'), query: z.string().min(1) }),
  z.object({ type: z.literal('ping') }),
]);

type DB = ReturnType<typeof createServiceClient>;

// ── In-memory cache (10 min, max 500 entries) ─────────────────────────
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 10 * 60 * 1000;
const MAX_CACHE = 500;

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

// ── Helpers ───────────────────────────────────────────────────────────

const PHASE_LABELS: Record<number, string> = {
  0: 'Emergence',
  1: 'Viralite courte',
  2: 'Fenetre ideale',
  3: 'Saturation',
};

function mgiBand(v: number): 'low' | 'medium' | 'high' | 'very_high' {
  if (v >= 75) return 'very_high';
  if (v >= 50) return 'high';
  if (v >= 25) return 'medium';
  return 'low';
}

function mgiConfidence(
  demand: number | null,
  supply: number | null,
  frustration: number | null,
): 'low' | 'medium' | 'high' {
  let sources = 0;
  if (demand != null && demand > 0) sources++;
  if (supply != null) sources++;
  if (frustration != null && frustration > 0) sources++;
  if (sources >= 3) return 'high';
  if (sources >= 2) return 'medium';
  return 'low';
}

function formatDateShort(d: string): string {
  const date = new Date(d);
  const months = ['janv.', 'fevr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'aout', 'sept.', 'oct.', 'nov.', 'dec.'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

function computeMedian(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function feasibilityGrade(
  channelSubs: number | null,
  channelMedian: number | null,
  topicSupplyQ: number | null,
  topicPhase: number | null,
): { grade: string; note: string } {
  let score = 50;
  if (topicPhase === 2) score += 20;
  else if (topicPhase === 0) score -= 10;
  else if (topicPhase === 3) score -= 25;
  if (topicSupplyQ != null) {
    if (topicSupplyQ < 30) score += 15;
    else if (topicSupplyQ > 70) score -= 15;
  }
  if (channelSubs != null && channelSubs > 100_000) score += 10;
  else if (channelSubs != null && channelSubs > 10_000) score += 5;
  else if (channelSubs != null && channelSubs < 1_000) score -= 10;
  if (channelMedian != null && channelSubs != null && channelSubs > 0) {
    const ratio = channelMedian / channelSubs;
    if (ratio > 0.3) score += 10;
    else if (ratio < 0.05) score -= 10;
  }
  if (score >= 80) return { grade: 'A', note: 'Excellente opportunite.' };
  if (score >= 65) return { grade: 'B', note: 'Bonne opportunite.' };
  if (score >= 50) return { grade: 'C', note: 'Competition moderee.' };
  if (score >= 35) return { grade: 'D', note: 'Difficile.' };
  if (score >= 20) return { grade: 'E', note: 'Tres difficile.' };
  return { grade: 'F', note: 'Deconseille.' };
}

// ── Route handlers ────────────────────────────────────────────────────

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? jsonWithCors(request, null, { status: 204 });
}

export async function POST(request: NextRequest) {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  const auth = await authenticateExtRequest(request);
  if (isAuthError(auth)) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors(request, { error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonWithCors(request, { error: 'Parametres invalides.' }, { status: 400 });
  }

  const input = parsed.data;
  if (input.type === 'ping') return jsonWithCors(request, { ok: true });

  // Le cache est séparé par compte : un client ne voit que ses thématiques.
  const scopeKey = auth.nicheIds === null ? 'admin' : auth.userId ?? 'legacy';
  const cacheKey = `${scopeKey}|${input.type === 'search' ? `s:${input.query}` : `${input.type[0]}:${input.id}`}`;
  const cached = getCached(cacheKey);
  if (cached) return jsonWithCors(request, cached);

  const db = createServiceClient();

  if (auth.nicheIds !== null && input.type !== 'search') {
    // Vidéo ou chaîne hors des thématiques du client : rien à montrer.
    const nicheId =
      input.type === 'video'
        ? ((await db.from('videos').select('channels(niche_id)').eq('id', input.id).maybeSingle()).data?.channels as unknown as { niche_id: string } | null)?.niche_id
        : ((await db.from('channels').select('niche_id').eq('id', input.id).maybeSingle()).data?.niche_id as string | undefined);
    if (!canSeeNiche(auth, nicheId)) {
      const empty = { found: false, type: input.type, outOfScope: true };
      setCache(cacheKey, empty);
      return jsonWithCors(request, empty);
    }
  }

  try {
    let result: unknown;
    if (input.type === 'video') result = await lookupVideo(db, input.id);
    else if (input.type === 'channel') result = await lookupChannel(db, input.id);
    else result = await lookupSearch(db, input.query, auth.nicheIds);
    setCache(cacheKey, result);
    return jsonWithCors(request, result);
  } catch {
    return jsonWithCors(request, { error: 'Erreur serveur.' }, { status: 500 });
  }
}

// ── Video lookup ──────────────────────────────────────────────────────

async function lookupVideo(db: DB, videoId: string) {
  const { data: video } = await db
    .from('videos')
    .select('id, title, topic_id, channel_id')
    .eq('id', videoId)
    .single();

  if (!video || !video.topic_id) {
    return { found: false, type: 'video' };
  }

  const scoreDate = await getLatestScoreDate(db);

  const [topicRes, scoreRes] = await Promise.all([
    db.from('topics').select('id, label, niche_id, phase').eq('id', video.topic_id).single(),
    db.from('topic_scores')
      .select('mgi, phase, demand, supply_q, frustration')
      .eq('topic_id', video.topic_id)
      .eq('scored_at', scoreDate)
      .single(),
  ]);

  const topic = topicRes.data;
  if (!topic) return { found: false, type: 'video' };
  const score = scoreRes.data;

  const { data: niche } = await db.from('niches').select('name').eq('id', topic.niche_id).single();

  // ── Outlier score ─────────────────────────────────────────────────
  let outlier = null;
  let channelMedian: number | null = null;

  if (video.channel_id) {
    const { data: snapshot } = await db
      .from('video_snapshots')
      .select('views, captured_at')
      .eq('video_id', videoId)
      .order('captured_at', { ascending: false })
      .limit(1)
      .single();

    if (snapshot?.views) {
      const { data: chVids } = await db
        .from('videos')
        .select('id')
        .eq('channel_id', video.channel_id)
        .limit(50);

      if (chVids && chVids.length > 2) {
        const ids = chVids.map((v: { id: string }) => v.id);
        const { data: snaps } = await db
          .from('video_snapshots')
          .select('video_id, views')
          .in('video_id', ids)
          .order('captured_at', { ascending: false });

        if (snaps) {
          const latest = new Map<string, number>();
          for (const s of snaps as { video_id: string; views: number | null }[]) {
            if (!latest.has(s.video_id) && s.views != null) latest.set(s.video_id, s.views);
          }
          const views = Array.from(latest.values()).filter((v) => v > 0).sort((a, b) => a - b);
          if (views.length > 2) {
            channelMedian = computeMedian(views);
            if (channelMedian > 0) {
              const ratio = snapshot.views / channelMedian;
              outlier = {
                ratio: Math.round(ratio * 10) / 10,
                median: channelMedian,
                views: snapshot.views,
                snapshotDate: formatDateShort(snapshot.captured_at),
                explanation: ratio >= 2
                  ? `${Math.round(ratio)}x la mediane (${channelMedian.toLocaleString('fr-FR')} vues)`
                  : ratio >= 1
                    ? `Legerement au-dessus de la mediane`
                    : `Sous la mediane de la chaine`,
              };
            }
          }
        }
      }
    }
  }

  // ── Feasibility ───────────────────────────────────────────────────
  let channelSubs: number | null = null;
  if (video.channel_id) {
    const { data: ch } = await db.from('channels').select('subscriber_count').eq('id', video.channel_id).single();
    channelSubs = ch?.subscriber_count ?? null;
  }
  const { grade, note } = feasibilityGrade(
    channelSubs,
    channelMedian,
    score?.supply_q ? Number(score.supply_q) : null,
    score?.phase ?? topic.phase,
  );

  // ── Frustrations (top 5) ──────────────────────────────────────────
  const { data: frustRows } = await db
    .from('comment_labels')
    .select('label, comments!inner(text, like_count, videos!inner(topic_id))')
    .eq('comments.videos.topic_id', video.topic_id)
    .neq('label', 'none')
    .gte('confidence', 0.7)
    .order('comments(like_count)', { ascending: false })
    .limit(5);

  const frustrations = (frustRows ?? []).map((f: Record<string, unknown>) => {
    const comment = f.comments as unknown as { text: string; like_count: number };
    return {
      text: (comment.text ?? '').slice(0, 150),
      label: f.label as string,
      likeCount: comment.like_count ?? 0,
    };
  });

  // ── Competitors (top 3) ───────────────────────────────────────────
  const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const { data: compRows } = await db
    .from('videos')
    .select('id, title, published_at, channels(title)')
    .eq('topic_id', video.topic_id)
    .eq('is_qualified', true)
    .neq('id', videoId)
    .gte('published_at', sixMonthsAgo)
    .order('published_at', { ascending: false })
    .limit(3);

  const competitors: { title: string; channelTitle: string; views: number | null; publishedAt: string }[] = [];
  if (compRows && compRows.length > 0) {
    const compIds = compRows.map((v: { id: string }) => v.id);
    const { data: compSnaps } = await db
      .from('video_snapshots')
      .select('video_id, views')
      .in('video_id', compIds)
      .order('captured_at', { ascending: false });
    const viewMap = new Map<string, number>();
    if (compSnaps) {
      for (const s of compSnaps as { video_id: string; views: number | null }[]) {
        if (!viewMap.has(s.video_id) && s.views != null) viewMap.set(s.video_id, s.views);
      }
    }
    for (const v of compRows as { id: string; title: string; published_at: string; channels: unknown }[]) {
      competitors.push({
        title: v.title,
        channelTitle: (v.channels as { title: string } | null)?.title ?? '',
        views: viewMap.get(v.id) ?? null,
        publishedAt: v.published_at,
      });
    }
  }

  // ── Build response ────────────────────────────────────────────────
  const phase = score?.phase ?? topic.phase;
  return {
    found: true,
    type: 'video',
    topicId: topic.id,
    topicLabel: topic.label,
    nicheName: niche?.name ?? null,
    phase: phase != null ? { phase, label: PHASE_LABELS[phase] ?? `Phase ${phase}` } : null,
    mgi: score?.mgi != null
      ? {
          value: Math.round(Number(score.mgi)),
          band: mgiBand(Number(score.mgi)),
          confidence: mgiConfidence(
            score.demand ? Number(score.demand) : null,
            score.supply_q ? Number(score.supply_q) : null,
            score.frustration ? Number(score.frustration) : null,
          ),
          freshness: formatDateShort(scoreDate),
        }
      : null,
    outlier,
    feasibilityGrade: grade,
    feasibilityNote: note,
    frustrations,
    competitors,
  };
}

// ── Channel lookup ────────────────────────────────────────────────────

async function lookupChannel(db: DB, channelId: string) {
  const { data: channel } = await db
    .from('channels')
    .select('id, title, subscriber_count, niche_id')
    .eq('id', channelId)
    .single();

  if (!channel) return lookupUnknownChannel(db, channelId);

  let nicheName = '';
  if (channel.niche_id) {
    const { data: niche } = await db.from('niches').select('name').eq('id', channel.niche_id).single();
    nicheName = niche?.name ?? '';
  }

  // ── Videos + median + pace ────────────────────────────────────────
  const { data: videos } = await db
    .from('videos')
    .select('id, title, published_at')
    .eq('channel_id', channelId)
    .order('published_at', { ascending: false })
    .limit(50);

  let medianViews: number | null = null;
  let publishingPace = '';
  const recentVideos: { id: string; title: string; views: number | null; outlierRatio: number | null; publishedAt: string }[] = [];

  if (videos && videos.length > 0) {
    const videoIds = videos.map((v: { id: string }) => v.id);
    const { data: snapshots } = await db
      .from('video_snapshots')
      .select('video_id, views')
      .in('video_id', videoIds)
      .order('captured_at', { ascending: false });

    const viewMap = new Map<string, number>();
    if (snapshots) {
      for (const s of snapshots as { video_id: string; views: number | null }[]) {
        if (!viewMap.has(s.video_id) && s.views != null) viewMap.set(s.video_id, s.views);
      }
    }

    const allViews = Array.from(viewMap.values()).filter((v) => v > 0).sort((a, b) => a - b);
    medianViews = allViews.length > 0 ? computeMedian(allViews) : null;

    // Pace: videos/week over 90 days
    const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
    const recentCount = videos.filter(
      (v: { published_at: string }) => new Date(v.published_at).getTime() > ninetyDaysAgo,
    ).length;
    const pace = recentCount / (90 / 7);
    publishingPace = pace >= 1
      ? `${pace.toFixed(1).replace('.', ',')} videos/sem.`
      : `${Math.round(pace * 4)} videos/mois`;

    for (const v of (videos as { id: string; title: string; published_at: string }[]).slice(0, 5)) {
      const views = viewMap.get(v.id) ?? null;
      recentVideos.push({
        id: v.id,
        title: v.title,
        views,
        outlierRatio:
          views != null && medianViews != null && medianViews > 0
            ? Math.round((views / medianViews) * 10) / 10
            : null,
        publishedAt: v.published_at,
      });
    }
  }

  // ── Similar channels ──────────────────────────────────────────────
  const similarChannels: { id: string; title: string; subscriberCount: number }[] = [];
  if (channel.niche_id) {
    const { data: siblings } = await db
      .from('channels')
      .select('id, title, subscriber_count')
      .eq('niche_id', channel.niche_id)
      .neq('id', channelId)
      .order('subscriber_count', { ascending: false })
      .limit(3);
    if (siblings) {
      for (const s of siblings as { id: string; title: string; subscriber_count: number }[]) {
        similarChannels.push({ id: s.id, title: s.title, subscriberCount: s.subscriber_count });
      }
    }
  }

  return {
    type: 'channel',
    found: true,
    channelTitle: channel.title,
    subscriberCount: channel.subscriber_count,
    nicheName,
    medianViews,
    publishingPace,
    recentVideos,
    similarChannels,
  };
}

// ── Unknown channel (1 YT API call) ─────────────────────────────────

async function lookupUnknownChannel(db: DB, channelId: string) {
  const { data: allNiches } = await db.from('niches').select('id, name').order('name');
  const niches = (allNiches ?? []).map((n: { id: string; name: string }) => ({ id: n.id, name: n.name }));

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return { type: 'channel', found: false, channelTitle: null, subscriberCount: null, estimatedMedian: null, niches };
  }

  try {
    const yt = new RealYouTubeClient(apiKey, 5);
    const channels = await yt.getChannels([channelId]);
    if (channels.length === 0) {
      return { type: 'channel', found: false, channelTitle: null, subscriberCount: null, estimatedMedian: null, niches };
    }
    const ch = channels[0];

    let estimatedMedian: number | null = null;
    if (ch.uploadsPlaylistId) {
      const videoIds = await yt.getPlaylistItems(ch.uploadsPlaylistId, 10);
      if (videoIds.length > 0) {
        const snapshots = await yt.getVideoSnapshots(videoIds);
        const views = snapshots.map((s) => s.views).filter((v) => v > 0).sort((a, b) => a - b);
        estimatedMedian = views.length > 0 ? computeMedian(views) : null;
      }
    }

    return {
      type: 'channel',
      found: false,
      channelTitle: ch.title,
      subscriberCount: ch.subscriberCount,
      estimatedMedian,
      niches,
    };
  } catch {
    return { type: 'channel', found: false, channelTitle: null, subscriberCount: null, estimatedMedian: null, niches };
  }
}

// ── Search ──────────────────────────────────────────────────────────

async function lookupSearch(db: DB, query: string, allowed: string[] | null) {
  const scoreDate = await getLatestScoreDate(db);

  let topicsQ = db
    .from('topics')
    .select('id, label, phase, niche_id')
    .ilike('label', `%${escapeLike(query)}%`);
  if (allowed !== null) {
    topicsQ = topicsQ.in('niche_id', allowed.length ? allowed : ['00000000-0000-0000-0000-000000000000']).in('status', ['active', 'in_production']);
  }
  const { data: topics } = await topicsQ.limit(10);

  if (!topics || topics.length === 0) {
    return { found: false, type: 'search', topics: [] };
  }

  const topicIds = topics.map((t: { id: string }) => t.id);
  const { data: scores } = await db
    .from('topic_scores')
    .select('topic_id, mgi, phase')
    .in('topic_id', topicIds)
    .eq('scored_at', scoreDate);

  const scoreMap = new Map<string, { mgi: number; phase: number }>();
  if (scores) {
    for (const s of scores as { topic_id: string; mgi: number; phase: number }[]) {
      scoreMap.set(s.topic_id, { mgi: Number(s.mgi), phase: s.phase });
    }
  }

  const nicheIds = [...new Set(topics.map((t: { niche_id: string }) => t.niche_id).filter(Boolean))];
  const { data: nicheRows } = nicheIds.length > 0
    ? await db.from('niches').select('id, name').in('id', nicheIds)
    : { data: null };
  const nicheMap = new Map<string, string>();
  if (nicheRows) {
    for (const n of nicheRows as { id: string; name: string }[]) nicheMap.set(n.id, n.name);
  }

  const results = topics
    .map((t: { id: string; label: string; phase: number | null; niche_id: string }) => {
      const s = scoreMap.get(t.id);
      return {
        id: t.id,
        label: t.label,
        mgi: s?.mgi ?? 0,
        phase: s?.phase ?? t.phase ?? 0,
        nicheName: nicheMap.get(t.niche_id) ?? undefined,
      };
    })
    .sort((a: { mgi: number }, b: { mgi: number }) => b.mgi - a.mgi)
    .slice(0, 5);

  return { found: results.length > 0, type: 'search', topics: results };
}
