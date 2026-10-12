import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/crypto/tokens';

/**
 * Statistiques privées d'une chaîne via l'API YouTube Analytics (avec l'accord du client).
 * Mises en cache 6 heures dans channel_analytics.
 */

export type Period = '7' | '28' | '90' | '365';
export const PERIODS: { key: Period; label: string }[] = [
  { key: '7', label: '7 jours' },
  { key: '28', label: '28 jours' },
  { key: '90', label: '90 jours' },
  { key: '365', label: '12 mois' },
];

export interface AnalyticsData {
  period: Period;
  startDate: string;
  endDate: string;
  totals: {
    views: number;
    minutesWatched: number;
    averageViewDuration: number;
    averageViewPercentage: number;
    subscribersGained: number;
    subscribersLost: number;
    likes: number;
    comments: number;
    shares: number;
  };
  daily: { date: string; views: number; minutes: number; subsNet: number; revenue: number | null }[];
  revenue: null | {
    estimatedRevenue: number;
    adRevenue: number;
    grossRevenue: number;
    cpm: number;
    playbackBasedCpm: number;
    monetizedPlaybacks: number;
    adImpressions: number;
    rpm: number;
  };
  /** Pourquoi les revenus manquent (chaîne non monétisée, accès refusé…). */
  revenueNote: string | null;
  topVideos: { id: string; title: string; views: number; minutes: number; avgDuration: number; avgPercent: number; subscribers: number; revenue: number | null }[];
  traffic: { key: string; views: number }[];
  countries: { key: string; views: number }[];
  devices: { key: string; views: number }[];
  demographics: { age: string; female: number; male: number; other: number }[];
  subscribed: { subscribed: number; notSubscribed: number };
}

const CACHE_HOURS = 6;

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function accessToken(refresh: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!res.ok || !json?.access_token) throw new Error(json?.error === 'invalid_grant' ? 'acces-retire' : 'jeton');
  return json.access_token;
}

type Rows = { columnHeaders?: { name: string }[]; rows?: (string | number)[][] };

async function report(token: string, params: Record<string, string>): Promise<Rows> {
  const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  url.searchParams.set('ids', 'channel==MINE');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) {
    const err = new Error(`analytics ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function toObjects(r: Rows): Record<string, number | string>[] {
  const names = (r.columnHeaders ?? []).map((h) => h.name);
  return (r.rows ?? []).map((row) => Object.fromEntries(row.map((v, i) => [names[i], v])));
}

const n = (v: unknown) => Number(v ?? 0) || 0;

async function fetchAll(token: string, period: Period, hasMonetary: boolean): Promise<AnalyticsData> {
  const end = new Date(Date.now() - 2 * 86_400_000); // YouTube consolide les chiffres avec ~2 jours de retard
  const start = new Date(end.getTime() - (Number(period) - 1) * 86_400_000);
  const base = { startDate: iso(start), endDate: iso(end) };

  const totalsQ = report(token, {
    ...base,
    metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares',
  });
  const dailyQ = report(token, { ...base, dimensions: 'day', sort: 'day', metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost' });
  const topQ = report(token, {
    ...base,
    dimensions: 'video',
    sort: '-views',
    maxResults: '10',
    metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained',
  });
  const trafficQ = report(token, { ...base, dimensions: 'insightTrafficSourceType', sort: '-views', metrics: 'views' });
  const countryQ = report(token, { ...base, dimensions: 'country', sort: '-views', maxResults: '10', metrics: 'views' });
  const deviceQ = report(token, { ...base, dimensions: 'deviceType', sort: '-views', metrics: 'views' });
  const demoQ = report(token, { ...base, dimensions: 'ageGroup,gender', metrics: 'viewerPercentage' });
  const subQ = report(token, { ...base, dimensions: 'subscribedStatus', metrics: 'views' });

  // Revenus : demandés à part, car ils échouent si la chaîne n'est pas monétisée.
  let revenue: AnalyticsData['revenue'] = null;
  let revenueNote: string | null = hasMonetary ? null : 'Accès aux revenus non accordé lors de la connexion Google.';
  let dailyRevenue = new Map<string, number>();
  const videoRevenue = new Map<string, number>();
  if (hasMonetary) {
    try {
      const [rt, rd] = await Promise.all([
        report(token, { ...base, currency: 'USD', metrics: 'estimatedRevenue,estimatedAdRevenue,grossRevenue,cpm,playbackBasedCpm,monetizedPlaybacks,adImpressions' }),
        report(token, { ...base, currency: 'USD', dimensions: 'day', sort: 'day', metrics: 'estimatedRevenue' }),
      ]);
      const t = toObjects(rt)[0] ?? {};
      revenue = {
        estimatedRevenue: n(t.estimatedRevenue),
        adRevenue: n(t.estimatedAdRevenue),
        grossRevenue: n(t.grossRevenue),
        cpm: n(t.cpm),
        playbackBasedCpm: n(t.playbackBasedCpm),
        monetizedPlaybacks: n(t.monetizedPlaybacks),
        adImpressions: n(t.adImpressions),
        rpm: 0,
      };
      dailyRevenue = new Map(toObjects(rd).map((r) => [String(r.day), n(r.estimatedRevenue)]));
      const rv = await report(token, { ...base, currency: 'USD', dimensions: 'video', sort: '-estimatedRevenue', maxResults: '25', metrics: 'estimatedRevenue' }).catch(() => null);
      for (const r of rv ? toObjects(rv) : []) videoRevenue.set(String(r.video), n(r.estimatedRevenue));
    } catch (e) {
      const status = (e as { status?: number }).status;
      revenueNote =
        status === 403
          ? 'Revenus indisponibles : la chaîne n’est pas monétisée, ou le compte Google choisi n’a pas accès aux revenus.'
          : 'Revenus momentanément indisponibles.';
    }
  }

  const [totalsR, dailyR, topR, trafficR, countryR, deviceR, demoR, subR] = await Promise.all(
    [totalsQ, dailyQ, topQ, trafficQ, countryQ, deviceQ, demoQ, subQ].map((p) => p.catch(() => ({}) as Rows)),
  );
  const t = toObjects(totalsR)[0] ?? {};
  const totals = {
    views: n(t.views),
    minutesWatched: n(t.estimatedMinutesWatched),
    averageViewDuration: n(t.averageViewDuration),
    averageViewPercentage: n(t.averageViewPercentage),
    subscribersGained: n(t.subscribersGained),
    subscribersLost: n(t.subscribersLost),
    likes: n(t.likes),
    comments: n(t.comments),
    shares: n(t.shares),
  };
  if (revenue) revenue.rpm = totals.views > 0 ? (revenue.estimatedRevenue / totals.views) * 1000 : 0;

  const topRows = toObjects(topR);
  // Titres des meilleures vidéos (API publique, 1 unité)
  const titles = new Map<string, string>();
  if (topRows.length && process.env.YOUTUBE_API_KEY) {
    const ids = topRows.map((r) => String(r.video)).join(',');
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids}&key=${process.env.YOUTUBE_API_KEY}`, { cache: 'no-store' }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { items?: { id: string; snippet: { title: string } }[] } | null;
    for (const it of json?.items ?? []) titles.set(it.id, it.snippet.title);
  }

  const demo = new Map<string, { female: number; male: number; other: number }>();
  for (const r of toObjects(demoR)) {
    const age = String(r.ageGroup).replace('age', '').replace('-', '–');
    const cur = demo.get(age) ?? { female: 0, male: 0, other: 0 };
    const g = String(r.gender);
    if (g === 'female') cur.female += n(r.viewerPercentage);
    else if (g === 'male') cur.male += n(r.viewerPercentage);
    else cur.other += n(r.viewerPercentage);
    demo.set(age, cur);
  }
  const sub = toObjects(subR);

  return {
    period,
    ...base,
    totals,
    daily: toObjects(dailyR).map((r) => ({
      date: String(r.day),
      views: n(r.views),
      minutes: n(r.estimatedMinutesWatched),
      subsNet: n(r.subscribersGained) - n(r.subscribersLost),
      revenue: revenue ? dailyRevenue.get(String(r.day)) ?? 0 : null,
    })),
    revenue,
    revenueNote,
    topVideos: topRows.map((r) => ({
      id: String(r.video),
      title: titles.get(String(r.video)) ?? String(r.video),
      views: n(r.views),
      minutes: n(r.estimatedMinutesWatched),
      avgDuration: n(r.averageViewDuration),
      avgPercent: n(r.averageViewPercentage),
      subscribers: n(r.subscribersGained),
      revenue: revenue ? videoRevenue.get(String(r.video)) ?? null : null,
    })),
    traffic: toObjects(trafficR).map((r) => ({ key: String(r.insightTrafficSourceType), views: n(r.views) })),
    countries: toObjects(countryR).map((r) => ({ key: String(r.country), views: n(r.views) })),
    devices: toObjects(deviceR).map((r) => ({ key: String(r.deviceType), views: n(r.views) })),
    demographics: [...demo.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([age, v]) => ({ age, ...v })),
    subscribed: {
      subscribed: n(sub.find((r) => r.subscribedStatus === 'SUBSCRIBED')?.views),
      notSubscribed: n(sub.find((r) => r.subscribedStatus === 'UNSUBSCRIBED')?.views),
    },
  };
}

export type AnalyticsState =
  | { status: 'absent' }
  | { status: 'ok'; data: AnalyticsData; fetchedAt: string; hasMonetary: boolean }
  | { status: 'erreur'; reason: 'acces-retire' | 'autre' };

/** Statistiques privées d'une chaîne pour une période, depuis le cache (6 h) ou YouTube. */
export async function getChannelAnalytics(db: SupabaseClient, userChannelId: string, period: Period, force = false): Promise<AnalyticsState> {
  const { data: tok, error } = await db
    .from('user_channel_tokens')
    .select('refresh_token_enc, scopes')
    .eq('user_channel_id', userChannelId)
    .maybeSingle();
  if (error || !tok) return { status: 'absent' };
  const hasMonetary = ((tok.scopes as string[]) ?? []).some((s) => s.endsWith('yt-analytics-monetary.readonly'));

  if (!force) {
    const { data: cached } = await db
      .from('channel_analytics')
      .select('data, fetched_at')
      .eq('user_channel_id', userChannelId)
      .eq('period', period)
      .maybeSingle();
    if (cached && Date.now() - new Date(cached.fetched_at as string).getTime() < CACHE_HOURS * 3_600_000) {
      return { status: 'ok', data: cached.data as AnalyticsData, fetchedAt: cached.fetched_at as string, hasMonetary };
    }
  }

  try {
    const token = await accessToken(decrypt(tok.refresh_token_enc as string));
    const data = await fetchAll(token, period, hasMonetary);
    const fetchedAt = new Date().toISOString();
    await db.from('channel_analytics').upsert({ user_channel_id: userChannelId, period, data, fetched_at: fetchedAt });
    await db.from('user_channel_tokens').update({ last_error: null }).eq('user_channel_id', userChannelId);
    return { status: 'ok', data, fetchedAt, hasMonetary };
  } catch (e) {
    const reason = (e as Error).message === 'acces-retire' ? 'acces-retire' : 'autre';
    await db.from('user_channel_tokens').update({ last_error: reason }).eq('user_channel_id', userChannelId);
    return { status: 'erreur', reason };
  }
}

/* ---------- Rétention d'une vidéo ---------- */

export interface RetentionData {
  videoId: string;
  /** 100 points : part de la vidéo écoulée (0 à 1) → part des spectateurs encore là (1 = 100 %). */
  points: { at: number; watch: number; relative: number | null }[];
  /** Moyenne de « relativeRetentionPerformance » : 0,5 = comme les vidéos YouTube de même durée. */
  relativeAvg: number | null;
}

export type RetentionState =
  | { status: 'absent' }
  | { status: 'ok'; data: RetentionData }
  | { status: 'erreur'; reason: 'acces-retire' | 'vide' | 'autre' };

/**
 * Courbe de rétention d'une vidéo (YouTube Analytics, dimension elapsedVideoTimeRatio), gardée 24 h en cache.
 * Seulement pour une vidéo de la chaîne connectée (l'API refuse les autres).
 */
export async function getVideoRetention(db: SupabaseClient, userChannelId: string, videoId: string): Promise<RetentionState> {
  const key = `ret:${videoId}`;
  const { data: cached } = await db
    .from('channel_analytics')
    .select('data, fetched_at')
    .eq('user_channel_id', userChannelId)
    .eq('period', key)
    .maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at as string).getTime() < 24 * 3_600_000) {
    return { status: 'ok', data: cached.data as RetentionData };
  }
  const { data: tok } = await db.from('user_channel_tokens').select('refresh_token_enc').eq('user_channel_id', userChannelId).maybeSingle();
  if (!tok) return { status: 'absent' };
  try {
    const token = await accessToken(decrypt(tok.refresh_token_enc as string));
    const end = new Date(Date.now() - 86_400_000);
    const r = await report(token, {
      startDate: '2006-01-01',
      endDate: iso(end),
      dimensions: 'elapsedVideoTimeRatio',
      metrics: 'audienceWatchRatio,relativeRetentionPerformance',
      filters: `video==${videoId}`,
      sort: 'elapsedVideoTimeRatio',
    });
    const rows = toObjects(r);
    if (!rows.length) return { status: 'erreur', reason: 'vide' };
    const points = rows.map((row) => ({
      at: n(row.elapsedVideoTimeRatio),
      watch: n(row.audienceWatchRatio),
      relative: row.relativeRetentionPerformance === undefined ? null : n(row.relativeRetentionPerformance),
    }));
    const rel = points.map((p) => p.relative).filter((x): x is number => x !== null);
    const data: RetentionData = { videoId, points, relativeAvg: rel.length ? rel.reduce((a, b) => a + b, 0) / rel.length : null };
    await db.from('channel_analytics').upsert({ user_channel_id: userChannelId, period: key, data, fetched_at: new Date().toISOString() });
    return { status: 'ok', data };
  } catch (e) {
    return { status: 'erreur', reason: (e as Error).message === 'acces-retire' ? 'acces-retire' : 'autre' };
  }
}
