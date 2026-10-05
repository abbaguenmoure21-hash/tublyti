import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Statistiques publiques d'une chaîne vérifiée, calculées à partir des vidéos déjà collectées
 * (aucun quota consommé). Disponibles pour toutes les chaînes vérifiées, même sans YouTube Analytics.
 */

export interface PublicVideo {
  id: string;
  title: string;
  publishedAt: string | null;
  durationS: number;
  thumbnailUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  isShort: boolean;
  /** Vues rapportées à la médiane du même format sur la chaîne (2 = deux fois plus). */
  ratio: number | null;
}

export interface PublicStats {
  channel: {
    id: string;
    youtubeId: string;
    title: string;
    handle: string | null;
    thumbnailUrl: string | null;
    subscribers: number | null;
    totalViews: number | null;
    videoCount: number | null;
    checkedAt: string | null;
    nicheName: string | null;
  };
  sample: number;
  medianViews: number;
  averageViews: number;
  engagementRate: number; // (likes + commentaires) / vues, en %
  likeRate: number;
  commentRate: number;
  uploadsPerWeek: number;
  daysSinceLast: number | null;
  bestWeekday: { day: string; median: number } | null;
  weekdays: { day: string; videos: number; median: number }[];
  shorts: { count: number; median: number };
  long: { count: number; median: number };
  viewsPerSubscriber: number | null;
  outliers: PublicVideo[];
  recent: PublicVideo[];
  monthly: { month: string; videos: number; views: number }[];
  estimate: null | { low: number; high: number; rpmLow: number; rpmHigh: number; views: number; source: string | null };
}

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

export async function getPublicStats(db: SupabaseClient, userChannelId: string): Promise<PublicStats | null> {
  const { data: uc } = await db
    .from('user_channels')
    .select('*, niches(name, rpm_low, rpm_high, rpm_source)')
    .eq('id', userChannelId)
    .maybeSingle();
  if (!uc) return null;
  const row = uc as Record<string, unknown> & { niches?: { name?: string; rpm_low?: number | null; rpm_high?: number | null; rpm_source?: string | null } | null };
  const youtubeId = String(row.youtube_channel_id ?? '');

  const { data: catalog } = youtubeId.startsWith('UC')
    ? await db.from('channels').select('title, subscriber_count').eq('id', youtubeId).maybeSingle()
    : { data: null };

  const { data: vids } = youtubeId.startsWith('UC')
    ? await db
        .from('videos')
        .select('id, title, published_at, duration_s, thumbnail_url')
        .eq('channel_id', youtubeId)
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(120)
    : { data: [] };
  const videos = (vids ?? []) as { id: string; title: string; published_at: string | null; duration_s: number | null; thumbnail_url: string | null }[];

  const latest = new Map<string, { views: number; likes: number; comments: number }>();
  if (videos.length) {
    const { data: snaps } = await db
      .from('video_snapshots')
      .select('video_id, captured_at, views, likes, comments')
      .in('video_id', videos.map((v) => v.id))
      .order('captured_at', { ascending: false });
    for (const s of (snaps ?? []) as { video_id: string; views: number; likes: number | null; comments: number | null }[]) {
      if (!latest.has(s.video_id)) latest.set(s.video_id, { views: Number(s.views) || 0, likes: Number(s.likes) || 0, comments: Number(s.comments) || 0 });
    }
  }

  const list: PublicVideo[] = videos
    .filter((v) => latest.has(v.id))
    .map((v) => {
      const s = latest.get(v.id)!;
      const d = Number(v.duration_s ?? 0);
      return {
        id: v.id,
        title: v.title,
        publishedAt: v.published_at,
        durationS: d,
        thumbnailUrl: v.thumbnail_url,
        views: s.views,
        likes: s.likes,
        comments: s.comments,
        isShort: d > 0 && d <= 180,
        ratio: null,
      };
    });

  const longs = list.filter((v) => !v.isShort);
  const shorts = list.filter((v) => v.isShort);
  const ref = median((longs.length ? longs : list).map((v) => v.views));
  const shortRef = median(shorts.map((v) => v.views));
  // Chaque format est comparé à lui-même : un Short à tes Shorts, une vidéo longue à tes vidéos longues.
  for (const v of list) {
    const base = v.isShort ? shortRef : ref;
    v.ratio = base > 0 && (v.isShort ? shorts.length : longs.length) >= 3 ? v.views / base : null;
  }

  const totalViews = list.reduce((a, v) => a + v.views, 0);
  const likes = list.reduce((a, v) => a + v.likes, 0);
  const comments = list.reduce((a, v) => a + v.comments, 0);

  // Rythme de publication sur les 90 derniers jours
  const now = Date.now();
  const dated = list.filter((v) => v.publishedAt).map((v) => ({ ...v, t: new Date(v.publishedAt!).getTime() }));
  const last90 = dated.filter((v) => now - v.t <= 90 * 86_400_000);
  const uploadsPerWeek = last90.length / (90 / 7);
  const daysSinceLast = dated.length ? Math.floor((now - Math.max(...dated.map((v) => v.t))) / 86_400_000) : null;

  // Jour de publication (vidéos longues de plus de 7 jours, pour des vues stabilisées)
  const mature = dated.filter((v) => !v.isShort && now - v.t > 7 * 86_400_000);
  const byDay = new Map<number, number[]>();
  for (const v of mature) {
    const d = new Date(v.t).getUTCDay();
    byDay.set(d, [...(byDay.get(d) ?? []), v.views]);
  }
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ day: DAYS[d], videos: byDay.get(d)?.length ?? 0, median: median(byDay.get(d) ?? []) }));
  const candidates = weekdays.filter((w) => w.videos >= 2).sort((a, b) => b.median - a.median);
  const bestWeekday = candidates.length >= 2 ? { day: candidates[0].day, median: candidates[0].median } : null;

  // Par mois (12 derniers mois)
  const months = new Map<string, { videos: number; views: number }>();
  for (const v of dated.filter((x) => now - x.t <= 365 * 86_400_000)) {
    const k = new Date(v.t).toISOString().slice(0, 7);
    const cur = months.get(k) ?? { videos: 0, views: 0 };
    cur.videos += 1;
    cur.views += v.views;
    months.set(k, cur);
  }
  const monthly = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));

  // Revenus estimés : vues des vidéos longues × fourchette de RPM de la thématique
  const rpmLow = Number(row.niches?.rpm_low ?? 0);
  const rpmHigh = Number(row.niches?.rpm_high ?? 0);
  const longViews = longs.reduce((a, v) => a + v.views, 0);
  const estimate =
    rpmLow > 0 && rpmHigh > 0 && longViews > 0
      ? { low: (longViews / 1000) * rpmLow, high: (longViews / 1000) * rpmHigh, rpmLow, rpmHigh, views: longViews, source: row.niches?.rpm_source ?? null }
      : null;

  const subscribers = (row.subscriber_count as number | null) ?? (catalog?.subscriber_count as number | null) ?? null;

  return {
    channel: {
      id: String(row.id),
      youtubeId,
      title: String(row.title ?? catalog?.title ?? 'Ma chaîne'),
      handle: (row.handle as string | null) ?? null,
      thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
      subscribers,
      totalViews: (row.view_count as number | null) ?? null,
      videoCount: (row.video_count as number | null) ?? null,
      checkedAt: (row.subscribers_checked_at as string | null) ?? null,
      nicheName: row.niches?.name ?? null,
    },
    sample: list.length,
    medianViews: ref,
    averageViews: list.length ? totalViews / list.length : 0,
    engagementRate: totalViews ? ((likes + comments) / totalViews) * 100 : 0,
    likeRate: totalViews ? (likes / totalViews) * 100 : 0,
    commentRate: totalViews ? (comments / totalViews) * 100 : 0,
    uploadsPerWeek,
    daysSinceLast,
    bestWeekday,
    weekdays,
    shorts: { count: shorts.length, median: median(shorts.map((v) => v.views)) },
    long: { count: longs.length, median: median(longs.map((v) => v.views)) },
    viewsPerSubscriber: subscribers && ref ? ref / subscribers : null,
    outliers: list.filter((v) => (v.ratio ?? 0) >= 2).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)).slice(0, 6),
    recent: list.slice(0, 15),
    monthly,
    estimate,
  };
}
