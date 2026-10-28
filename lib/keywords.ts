import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeLike } from './utils';

/**
 * « Market cap » d'un mot : compare plusieurs mots-clés sur les vidéos du catalogue
 * (ta niche, ou toutes les niches) qui les contiennent dans leur titre.
 * Ce qui compte : combien de vues ces vidéos font, et surtout combien elles font
 * par rapport aux vues habituelles de leur chaîne (= la demande propre au mot, pas la taille des chaînes).
 */

export interface KeywordStat {
  term: string;
  videos: number;
  channels: number;
  /** Vues médianes estimées (score × vues habituelles de la chaîne). */
  medianViews: number | null;
  /** Sur-performance médiane (1 = vues habituelles). */
  medianScore: number | null;
  /** Part des vidéos à ≥ 2× les vues habituelles de leur chaîne. */
  share2x: number | null;
  recent90d: number;
  best: { videoId: string; title: string; score: number }[];
}

export interface KeywordComparison {
  scope: 'niche' | 'all';
  stats: KeywordStat[];
  winner: string | null;
  verdict: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function statFor(db: SupabaseClient, term: string, channelIds: string[] | null): Promise<KeywordStat> {
  const pattern = `%${escapeLike(term)}%`;
  const rows: { id: string; title: string; channel_id: string; published_at: string | null }[] = [];
  if (channelIds) {
    for (let i = 0; i < channelIds.length && rows.length < 2000; i += 100) {
      const { data } = await db.from('videos').select('id, title, channel_id, published_at').in('channel_id', channelIds.slice(i, i + 100)).ilike('title', pattern).limit(1000);
      rows.push(...((data ?? []) as typeof rows));
    }
  } else {
    const { data } = await db.from('videos').select('id, title, channel_id, published_at').ilike('title', pattern).order('published_at', { ascending: false }).limit(2000);
    rows.push(...((data ?? []) as typeof rows));
  }
  const scores = new Map<string, { score: number; baseline: number }>();
  for (let i = 0; i < rows.length; i += 200) {
    const { data } = await db.from('video_outliers').select('video_id, score, baseline').in('video_id', rows.slice(i, i + 200).map((r) => r.id));
    for (const o of (data ?? []) as { video_id: string; score: number; baseline: number }[]) scores.set(o.video_id, { score: Number(o.score), baseline: Number(o.baseline) });
  }
  const scored = rows.filter((r) => scores.has(r.id));
  const sc = scored.map((r) => scores.get(r.id)!.score);
  const views = scored.map((r) => scores.get(r.id)!.score * scores.get(r.id)!.baseline).filter((v) => v > 0);
  const since = Date.now() - 90 * 86_400_000;
  return {
    term,
    videos: rows.length,
    channels: new Set(rows.map((r) => r.channel_id)).size,
    medianViews: views.length ? Math.round(median(views)!) : null,
    medianScore: sc.length ? Math.round(median(sc)! * 100) / 100 : null,
    share2x: sc.length ? Math.round((sc.filter((x) => x >= 2).length / sc.length) * 100) / 100 : null,
    recent90d: rows.filter((r) => r.published_at && new Date(r.published_at).getTime() >= since).length,
    best: scored
      .map((r) => ({ videoId: r.id, title: r.title, score: scores.get(r.id)!.score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
  };
}

export async function compareKeywords(db: SupabaseClient, terms: string[], nicheIds: string[] | null): Promise<KeywordComparison> {
  const clean = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 4);
  let channelIds: string[] | null = null;
  if (nicheIds?.length) {
    const { data } = await db.from('channels').select('id').in('niche_id', nicheIds).limit(1000);
    channelIds = ((data ?? []) as { id: string }[]).map((c) => c.id);
  }
  const stats = await Promise.all(clean.map((t) => statFor(db, t, channelIds)));

  // Gagnant : meilleure sur-performance médiane, avec assez de vidéos pour que ce soit sérieux.
  const eligible = stats.filter((s) => s.medianScore !== null && s.videos >= 5);
  const ranked = [...eligible].sort((a, b) => (b.medianScore ?? 0) - (a.medianScore ?? 0));
  const winner = ranked[0]?.term ?? null;
  let verdict: string;
  if (!winner) verdict = 'Pas assez de vidéos avec ces mots dans le catalogue pour trancher (5 minimum par mot). Essaie des mots plus courants ou toutes les niches.';
  else if (ranked.length === 1) verdict = `Seul « ${winner} » a assez de vidéos pour être jugé.`;
  else {
    const a = ranked[0];
    const b = ranked[1];
    const ratio = (a.medianScore ?? 1) / Math.max(0.01, b.medianScore ?? 1);
    verdict =
      ratio >= 1.3
        ? `« ${a.term} » attire nettement plus : ses vidéos font ×${a.medianScore!.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} les vues habituelles de leur chaîne, contre ×${b.medianScore!.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pour « ${b.term} ». Mets-le dans le titre.`
        : `« ${a.term} » et « ${b.term} » se valent (×${a.medianScore!.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} contre ×${b.medianScore!.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}) : choisis celui qui parle le plus à ton public, ou combine-les.`;
  }
  return { scope: nicheIds?.length ? 'niche' : 'all', stats, winner, verdict };
}
