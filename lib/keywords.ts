import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeLike } from './utils';
import { readAllPages } from './supabase/rpc-fallback';

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

type OutlierRow = { score: number; baseline: number };

async function statFor(db: SupabaseClient, term: string, nicheIds: string[] | null): Promise<KeywordStat> {
  const pattern = `%${escapeLike(term)}%`;
  // One paginated query per word (outlier scores embedded, niche filtered through the channel join),
  // instead of up to ~20 serial round-trips; served by the trigram index on videos.title (00031).
  const { data: raw } = await readAllPages<{ id: string; title: string; channel_id: string; published_at: string | null; video_outliers: OutlierRow | OutlierRow[] | null }>(
    (from, to) => {
      let q = db
        .from('videos')
        .select(nicheIds ? 'id, title, channel_id, published_at, video_outliers(score, baseline), channels!inner(niche_id)' : 'id, title, channel_id, published_at, video_outliers(score, baseline)')
        .ilike('title', pattern);
      if (nicheIds) q = q.in('channels.niche_id', nicheIds);
      return q.order('published_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
    },
    2000,
  );
  const rows = raw.map(({ id, title, channel_id, published_at }) => ({ id, title, channel_id, published_at }));
  const scores = new Map<string, { score: number; baseline: number }>();
  for (const r of raw) {
    const o = Array.isArray(r.video_outliers) ? r.video_outliers[0] : r.video_outliers;
    if (o) scores.set(r.id, { score: Number(o.score), baseline: Number(o.baseline) });
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
  const stats = await Promise.all(clean.map((t) => statFor(db, t, nicheIds?.length ? nicheIds : null)));

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
