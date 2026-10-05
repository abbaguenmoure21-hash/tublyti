/**
 * Lecture d'une chaîne YouTube à partir de ce qu'un client colle :
 * lien de chaîne (/channel/UC…, /@pseudo, /c/nom, /user/nom), pseudo « @… », identifiant UC…,
 * ou lien d'une de ses vidéos. Coût : 1 unité de quota (2 pour un lien de vidéo).
 */

export interface YouTubeChannelCard {
  id: string;
  title: string;
  handle: string | null;
  description: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  videoCount: number;
  viewCount: number;
  uploadsPlaylistId: string | null;
  country: string | null;
}

type Query = { id: string } | { forHandle: string } | { forUsername: string } | { video: string };

export function parseChannelInput(raw: string): Query | null {
  const input = raw.trim();
  if (!input) return null;
  const uc = input.match(/(UC[\w-]{22})/);
  if (uc) return { id: uc[1] };
  const video = input.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([\w-]{11})/);
  if (video) return { video: video[1] };
  const handle = input.match(/(?:^|\/)@([\w.-]+)/);
  if (handle) return { forHandle: handle[1] };
  const user = input.match(/youtube\.com\/user\/([\w.-]+)/);
  if (user) return { forUsername: user[1] };
  const custom = input.match(/youtube\.com\/c\/([\w.-]+)/);
  if (custom) return { forHandle: custom[1] };
  if (/^[\w.-]{3,30}$/.test(input)) return { forHandle: input };
  return null;
}

async function yt(endpoint: string, params: Record<string, string>): Promise<{ items?: Record<string, unknown>[] }> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY manquante');
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`YouTube ${endpoint} ${res.status}`);
  return res.json();
}

/** Renvoie la fiche de la chaîne, ou null si elle est introuvable. */
export async function lookupChannel(raw: string): Promise<YouTubeChannelCard | null> {
  let q = parseChannelInput(raw);
  if (!q) return null;
  if ('video' in q) {
    const v = await yt('videos', { part: 'snippet', id: q.video });
    const channelId = (v.items?.[0]?.snippet as { channelId?: string } | undefined)?.channelId;
    if (!channelId) return null;
    q = { id: channelId };
  }
  const data = await yt('channels', { part: 'snippet,statistics,contentDetails', maxResults: '1', ...(q as Record<string, string>) });
  const item = data.items?.[0];
  if (!item) return null;
  const sn = item.snippet as {
    title: string; description?: string; customUrl?: string; country?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  const st = item.statistics as { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string; viewCount?: string };
  const cd = item.contentDetails as { relatedPlaylists?: { uploads?: string } };
  return {
    id: item.id as string,
    title: sn.title,
    handle: sn.customUrl ?? null,
    description: sn.description ?? '',
    thumbnailUrl: sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? null,
    subscriberCount: st.hiddenSubscriberCount ? null : Number(st.subscriberCount ?? 0),
    videoCount: Number(st.videoCount ?? 0),
    viewCount: Number(st.viewCount ?? 0),
    uploadsPlaylistId: cd.relatedPlaylists?.uploads ?? null,
    country: sn.country ?? null,
  };
}

/** Dernières vidéos de la chaîne avec leurs statistiques (2 unités). */
export async function latestVideos(uploadsPlaylistId: string, max = 50) {
  const pl = await yt('playlistItems', { part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: String(Math.min(max, 50)) });
  const ids = (pl.items ?? [])
    .map((i) => (i.contentDetails as { videoId?: string } | undefined)?.videoId)
    .filter((x): x is string => Boolean(x));
  if (!ids.length) return [];
  const v = await yt('videos', { part: 'snippet,contentDetails,statistics', id: ids.join(','), maxResults: '50' });
  return (v.items ?? []).map((item) => {
    const sn = item.snippet as { title: string; publishedAt: string; channelId: string; thumbnails?: Record<string, { url?: string }> };
    const cd = item.contentDetails as { duration?: string };
    const st = item.statistics as { viewCount?: string; likeCount?: string; commentCount?: string };
    const m = (cd.duration ?? '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const duration = m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
    return {
      id: item.id as string,
      channelId: sn.channelId,
      title: sn.title,
      publishedAt: sn.publishedAt,
      durationS: duration,
      thumbnailUrl: sn.thumbnails?.medium?.url ?? null,
      views: Number(st.viewCount ?? 0),
      likes: Number(st.likeCount ?? 0),
      comments: Number(st.commentCount ?? 0),
    };
  });
}
