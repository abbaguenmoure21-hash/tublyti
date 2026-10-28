import type { SupabaseClient } from '@supabase/supabase-js';
import { embedTitles } from './preflight/titles';

/**
 * Saturation d'un sujet ou d'une vidéo qui a sur-performé.
 *
 * Un sujet est saturé quand beaucoup de chaînes s'y mettent en même temps ET que les nouvelles vidéos
 * font moins bien que les précédentes : la demande ne suit plus l'offre.
 * Une vidéo gagnante est « saturée » quand son idée a déjà été copiée par beaucoup de chaînes
 * et que les copies ne marchent plus.
 */

export type SaturationLevel = 'open' | 'filling' | 'saturated' | 'unknown';

export const LEVEL_LABEL: Record<SaturationLevel, string> = {
  open: 'Peu de concurrence',
  filling: 'Concurrence en hausse',
  saturated: 'Trop de concurrence',
  unknown: 'Pas assez de données',
};

export interface TopicSaturation {
  level: SaturationLevel;
  score: number | null;
  reasons: string[];
  advice: string;
  stats: {
    videos30d: number;
    channels30d: number;
    perWeekNow: number;
    perWeekBefore: number;
    medianScoreNow: number | null;
    medianScoreBefore: number | null;
    winRateNow: number | null;
  };
}

const DAY = 86_400_000;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const r1 = (x: number) => Math.round(x * 10) / 10;
const fmt = (x: number) => `×${x.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;

export async function topicSaturation(db: SupabaseClient, topicId: string): Promise<TopicSaturation> {
  const { data: vids } = await db.from('videos').select('id, channel_id, published_at').eq('topic_id', topicId).not('published_at', 'is', null).limit(3000);
  const list = (vids ?? []) as { id: string; channel_id: string; published_at: string }[];
  const scores = new Map<string, { score: number; age: number }>();
  for (let i = 0; i < list.length; i += 200) {
    // 'approximate' scores compare a young video with lifetime views of older ones: they are biased low
    // and would wrongly read as "new videos do worse" (wear). Only same-age scores are used here.
    const { data } = await db
      .from('video_outliers')
      .select('video_id, score, age_days')
      .eq('method', 'same_age')
      .in('video_id', list.slice(i, i + 200).map((v) => v.id));

    for (const o of (data ?? []) as { video_id: string; score: number; age_days: number }[]) scores.set(o.video_id, { score: Number(o.score), age: o.age_days });
  }

  const now = Date.now();
  const recent = list.filter((v) => now - new Date(v.published_at).getTime() <= 30 * DAY);
  const before = list.filter((v) => {
    const age = now - new Date(v.published_at).getTime();
    return age > 30 * DAY && age <= 120 * DAY;
  });
  const perWeekNow = (recent.length / 30) * 7;
  const perWeekBefore = (before.length / 90) * 7;
  const channels30d = new Set(recent.map((v) => v.channel_id)).size;
  // Seules les vidéos assez âgées pour être jugées (≥ 3 jours) comptent pour la performance.
  const scoredNow = recent.map((v) => scores.get(v.id)).filter((s): s is { score: number; age: number } => !!s && s.age >= 3).map((s) => s.score);
  const scoredBefore = before.map((v) => scores.get(v.id)?.score).filter((s): s is number => typeof s === 'number');
  const medNow = median(scoredNow);
  const medBefore = median(scoredBefore);
  const winRate = scoredNow.length >= 3 ? scoredNow.filter((s) => s >= 1).length / scoredNow.length : null;

  const stats = {
    videos30d: recent.length,
    channels30d,
    perWeekNow: r1(perWeekNow),
    perWeekBefore: r1(perWeekBefore),
    medianScoreNow: medNow === null ? null : Math.round(medNow * 100) / 100,
    medianScoreBefore: medBefore === null ? null : Math.round(medBefore * 100) / 100,
    winRateNow: winRate === null ? null : Math.round(winRate * 100) / 100,
  };

  if (list.length < 5) {
    return { level: 'unknown', score: null, reasons: [`Seulement ${list.length} vidéo${list.length > 1 ? 's' : ''} rattachée${list.length > 1 ? 's' : ''} à ce sujet.`], advice: 'Trop tôt pour juger : un sujet peu couvert est souvent une opportunité, vérifie la demande.', stats };
  }

  // 1. Pression de l'offre : combien de chaînes différentes ont publié ce mois-ci.
  const pressure = clamp01(channels30d / 12);
  // 2. Accélération : publie-t-on beaucoup plus qu'avant ?
  const accel = perWeekBefore > 0 ? perWeekNow / perWeekBefore : perWeekNow > 0 ? 3 : 1;
  const acceleration = clamp01((accel - 1) / 2);
  // 3. Usure : les nouvelles vidéos font-elles moins bien que celles d'avant ?
  const decayRatio = medNow !== null && medBefore !== null && medBefore > 0 ? medNow / medBefore : null;
  const decay = decayRatio === null ? 0.3 : clamp01((1 - decayRatio) / 0.6);
  // 4. Peu de gagnants parmi les nouvelles vidéos.
  const lowWins = winRate === null ? 0.3 : clamp01((0.5 - winRate) / 0.5);

  const score = Math.round(100 * (0.35 * pressure + 0.2 * acceleration + 0.3 * decay + 0.15 * lowWins));
  const level: SaturationLevel = score >= 65 ? 'saturated' : score >= 35 ? 'filling' : 'open';

  const reasons: string[] = [];
  reasons.push(`${channels30d} chaîne${channels30d > 1 ? 's' : ''} ${channels30d > 1 ? 'ont' : 'a'} publié sur ce sujet ces 30 derniers jours (${recent.length} vidéo${recent.length > 1 ? 's' : ''}).`);
  if (perWeekBefore > 0 || perWeekNow > 0) {
    reasons.push(
      accel >= 1.5
        ? `Le rythme s’accélère : ${stats.perWeekNow} vidéo${stats.perWeekNow >= 2 ? 's' : ''} par semaine contre ${stats.perWeekBefore} avant.`
        : accel <= 0.7
          ? `Le rythme ralentit : ${stats.perWeekNow} vidéo${stats.perWeekNow >= 2 ? 's' : ''} par semaine contre ${stats.perWeekBefore} avant.`
          : `Rythme stable : environ ${stats.perWeekNow} vidéo${stats.perWeekNow >= 2 ? 's' : ''} par semaine.`,
    );
  }
  if (decayRatio !== null) {
    reasons.push(
      decayRatio < 0.8
        ? `Les nouvelles vidéos font moins bien : ${fmt(medNow!)} leurs vues habituelles, contre ${fmt(medBefore!)} il y a 1 à 4 mois.`
        : decayRatio > 1.2
          ? `Les nouvelles vidéos font mieux qu’avant : ${fmt(medNow!)} contre ${fmt(medBefore!)}. La demande suit.`
          : `Les nouvelles vidéos font aussi bien qu’avant (${fmt(medNow!)}).`,
    );
  }
  if (winRate !== null) reasons.push(`${Math.round(winRate * 100)} % des vidéos récentes dépassent les vues habituelles de leur chaîne.`);

  const advice =
    level === 'open'
      ? 'Fonce : peu de concurrence récente et les vidéos marchent encore.'
      : level === 'filling'
        ? 'Encore jouable, mais avec un angle que les autres n’ont pas pris : un public plus précis, un format différent, une question des commentaires.'
        : decayRatio !== null && decayRatio > 1
          ? 'Beaucoup de concurrence mais la demande suit encore : seulement si ta vidéo est nettement meilleure que les récentes.'
          : 'Évite le sujet principal : vise un sous-angle précis ou un sujet voisin moins couvert.';

  return { level, score, reasons, advice, stats };
}

export interface OutlierSaturation {
  level: SaturationLevel;
  copies: number;
  copyChannels: number;
  copiesLast30d: number;
  medianCopyScore: number | null;
  /** Vidéos très proches publiées AVANT (l'idée existait déjà). */
  earlier: number;
  verdict: string;
  examples: { videoId: string; title: string; channelTitle: string; score: number; publishedAt: string }[];
}

function parseVec(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return `[${raw.join(',')}]`;
  return null;
}

function rpcMessage(msg: string): string {
  if (/function .*match_niche_videos.* does not exist|Could not find the function/i.test(msg)) return 'La migration 00029 n’est pas encore appliquée dans Supabase (fonction match_niche_videos absente).';
  if (/timeout|canceling statement/i.test(msg)) return 'La recherche a pris trop de temps. Réessaie dans un instant.';
  return `Recherche impossible : ${msg.slice(0, 160)}`;
}

/** Cœur commun : vidéos de la niche aux titres très proches, avant et après une date. */
async function ideaSaturation(
  db: SupabaseClient,
  opts: { vec: string; nicheIds: string[]; originMs: number; excludeId?: string | null; excludeChannelId?: string | null },
): Promise<OutlierSaturation> {
  const { data, error } = await db.rpc('match_niche_videos', { query_embedding: opts.vec, niche_ids: opts.nicheIds, match_count: 80 });
  if (error) throw new Error(rpcMessage(error.message));
  const near = ((data ?? []) as { video_id: string; title: string; channel_id: string; channel_title: string | null; similarity: number; score: number }[]).filter(
    (n) => n.video_id !== opts.excludeId && (!opts.excludeChannelId || n.channel_id !== opts.excludeChannelId) && Number(n.similarity) >= 0.78,
  );
  const { data: dates } = near.length ? await db.from('videos').select('id, published_at').in('id', near.map((n) => n.video_id)) : { data: [] };
  const pub = new Map(((dates ?? []) as { id: string; published_at: string | null }[]).map((d) => [d.id, d.published_at]));
  const dated = near
    .filter((n) => pub.get(n.video_id))
    .map((n) => ({ videoId: n.video_id, title: n.title, channelTitle: n.channel_title ?? '', score: Number(n.score), publishedAt: pub.get(n.video_id) as string }));
  const copies = dated.filter((c) => new Date(c.publishedAt).getTime() > opts.originMs);
  const earlier = dated.length - copies.length;

  const copyChannels = new Set(copies.map((c) => c.channelTitle)).size;
  const copiesLast30d = copies.filter((c) => Date.now() - new Date(c.publishedAt).getTime() <= 30 * DAY).length;
  const med = median(copies.map((c) => c.score));
  let level: SaturationLevel;
  let verdict: string;
  if (copies.length <= 2) {
    level = 'open';
    verdict = copies.length ? `Presque pas copiée (${copies.length} vidéo${copies.length > 1 ? 's' : ''} proche${copies.length > 1 ? 's' : ''} depuis) : l’idée est encore à prendre.` : 'Personne n’a encore repris cette idée dans la niche : c’est le bon moment.';
  } else if (copies.length >= 8 || (copies.length >= 4 && med !== null && med < 0.8)) {
    level = 'saturated';
    verdict = `Déjà reprise ${copies.length} fois par ${copyChannels} chaîne${copyChannels > 1 ? 's' : ''}${med !== null ? `, et les copies ne font plus que ${fmt(med)} leurs vues habituelles` : ''} : ne la refais pas telle quelle.`;
  } else {
    level = 'filling';
    verdict = `Reprise ${copies.length} fois${med !== null ? ` (copies à ${fmt(med)} en médiane)` : ''} : refais-la avec un angle nouveau, pas en copie.`;
  }
  return {
    level,
    copies: copies.length,
    copyChannels,
    copiesLast30d,
    medianCopyScore: med === null ? null : Math.round(med * 100) / 100,
    earlier,
    verdict,
    examples: copies.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 5),
  };
}

/** L'idée d'une vidéo gagnante a-t-elle déjà été copiée, et les copies marchent-elles encore ? */
export async function outlierSaturation(db: SupabaseClient, videoId: string): Promise<OutlierSaturation | null> {
  const { data: v } = await db.from('videos').select('id, title, published_at, channel_id, title_embedding, channels(niche_id)').eq('id', videoId).maybeSingle();
  const vec = parseVec(v?.title_embedding);
  const nicheId = (v?.channels as unknown as { niche_id: string | null } | null)?.niche_id;
  if (!v || !vec || !nicheId || !v.published_at) return null;
  return ideaSaturation(db, { vec, nicheIds: [nicheId], originMs: new Date(v.published_at as string).getTime(), excludeId: videoId, excludeChannelId: v.channel_id as string });
}

export interface LinkSaturation {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  nicheName: string | null;
  inCatalog: boolean;
  result: OutlierSaturation;
}

/**
 * N'importe quel lien YouTube, même une vidéo que TubLyTI ne suit pas :
 * titre lu sur YouTube, niche déduite des vidéos les plus proches du catalogue, puis recherche des copies.
 */
export async function linkSaturation(db: SupabaseClient, input: string, preferNicheIds: string[] = []): Promise<LinkSaturation | { error: string }> {
  const m = input.trim().match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/);
  const videoId = m?.[1] ?? (/^[\w-]{11}$/.test(input.trim()) ? input.trim() : null);
  if (!videoId) return { error: 'Lien YouTube invalide.' };

  // Déjà dans le catalogue : on a tout ce qu'il faut.
  const { data: known } = await db.from('videos').select('id, title, published_at, channel_id, title_embedding, channels(title, niche_id, niches(name))').eq('id', videoId).maybeSingle();
  const kch = known?.channels as unknown as { title: string | null; niche_id: string | null; niches: { name: string } | null } | null;
  if (known && parseVec(known.title_embedding) && kch?.niche_id && known.published_at) {
    const result = await ideaSaturation(db, { vec: parseVec(known.title_embedding)!, nicheIds: [kch.niche_id], originMs: new Date(known.published_at as string).getTime(), excludeId: videoId, excludeChannelId: known.channel_id as string });
    return { videoId, title: known.title as string, channelTitle: kch.title ?? '', publishedAt: known.published_at as string, nicheName: kch.niches?.name ?? null, inCatalog: true, result };
  }

  // Inconnue : titre et date depuis YouTube (1 unité de quota).
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { error: 'YOUTUBE_API_KEY manquante.' };
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${key}`, { cache: 'no-store' }).catch(() => null);
  const j = res?.ok ? ((await res.json()) as { items?: { snippet?: { title?: string; channelTitle?: string; channelId?: string; publishedAt?: string } }[] }) : null;
  const sn = j?.items?.[0]?.snippet;
  if (!sn?.title || !sn.publishedAt) return { error: 'Vidéo introuvable sur YouTube (privée ou supprimée ?).' };

  const [vecArr] = (await embedTitles([sn.title])) ?? [];
  if (!vecArr?.length) return { error: 'Analyse du titre impossible pour le moment (VOYAGE_API_KEY ?).' };
  const vec = `[${vecArr.join(',')}]`;

  // Niche : celle des chaînes du catalogue dont le contenu ressemble le plus à ce titre
  // (recherche sur les chaînes, rapide), sinon la niche de ta chaîne.
  const { data: niches } = await db.from('niches').select('id, name');
  const nicheList = (niches ?? []) as { id: string; name: string }[];
  const votes = new Map<string, number>();
  const { data: nearCh } = await db.rpc('match_channels', { query_embedding: vec, match_threshold: 0.2, match_count: 15 });
  for (const c of (nearCh ?? []) as { niche_id: string | null; similarity: number }[]) {
    if (c.niche_id) votes.set(c.niche_id, (votes.get(c.niche_id) ?? 0) + Number(c.similarity));
  }
  let nicheId = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!nicheId && preferNicheIds.length) nicheId = preferNicheIds[0];
  if (!nicheId) return { error: 'Impossible de rattacher cette vidéo à une niche suivie par TubLyTI.' };
  const top: [string, number] = [nicheId, 0];

  const result = await ideaSaturation(db, { vec, nicheIds: [top[0]], originMs: new Date(sn.publishedAt).getTime(), excludeId: videoId, excludeChannelId: sn.channelId ?? null });
  return { videoId, title: sn.title, channelTitle: sn.channelTitle ?? '', publishedAt: sn.publishedAt, nicheName: nicheList.find((n) => n.id === top[0])?.name ?? null, inCatalog: false, result };
}
