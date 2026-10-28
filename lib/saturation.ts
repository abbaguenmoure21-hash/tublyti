import type { SupabaseClient } from '@supabase/supabase-js';

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
  open: 'Ouvert',
  filling: 'Se remplit',
  saturated: 'Saturé',
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
    const { data } = await db.from('video_outliers').select('video_id, score, age_days').in('video_id', list.slice(i, i + 200).map((v) => v.id));
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
  verdict: string;
  examples: { videoId: string; title: string; channelTitle: string; score: number; publishedAt: string }[];
}

function parseVec(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return `[${raw.join(',')}]`;
  return null;
}

/** L'idée d'une vidéo gagnante a-t-elle déjà été copiée, et les copies marchent-elles encore ? */
export async function outlierSaturation(db: SupabaseClient, videoId: string): Promise<OutlierSaturation | null> {
  const { data: v } = await db.from('videos').select('id, title, published_at, channel_id, title_embedding, channels(niche_id)').eq('id', videoId).maybeSingle();
  const vec = parseVec(v?.title_embedding);
  const nicheId = (v?.channels as unknown as { niche_id: string | null } | null)?.niche_id;
  if (!v || !vec || !nicheId || !v.published_at) return null;

  const { data } = await db.rpc('match_niche_videos', { query_embedding: vec, niche_ids: [nicheId], match_count: 80 });
  const near = ((data ?? []) as { video_id: string; title: string; channel_id: string; channel_title: string | null; similarity: number; score: number }[]).filter(
    (n) => n.video_id !== videoId && n.channel_id !== v.channel_id && Number(n.similarity) >= 0.78,
  );
  const { data: dates } = near.length ? await db.from('videos').select('id, published_at').in('id', near.map((n) => n.video_id)) : { data: [] };
  const pub = new Map(((dates ?? []) as { id: string; published_at: string | null }[]).map((d) => [d.id, d.published_at]));
  const origin = new Date(v.published_at as string).getTime();
  const copies = near
    .filter((n) => {
      const p = pub.get(n.video_id);
      return p && new Date(p).getTime() > origin;
    })
    .map((n) => ({ videoId: n.video_id, title: n.title, channelTitle: n.channel_title ?? '', score: Number(n.score), publishedAt: pub.get(n.video_id) as string }));

  const copyChannels = new Set(copies.map((c) => c.channelTitle)).size;
  const copiesLast30d = copies.filter((c) => Date.now() - new Date(c.publishedAt).getTime() <= 30 * DAY).length;
  const med = median(copies.map((c) => c.score));
  let level: SaturationLevel;
  let verdict: string;
  if (copies.length <= 2) {
    level = 'open';
    verdict = copies.length ? `Presque pas copiée (${copies.length} vidéo${copies.length > 1 ? 's' : ''} proche${copies.length > 1 ? 's' : ''} depuis) : l’idée est encore à prendre.` : 'Personne n’a encore repris cette idée dans ta niche : c’est le bon moment.';
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
    verdict,
    examples: copies.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 5),
  };
}
