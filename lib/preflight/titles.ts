import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Note d'un titre : comparaison avec les vidéos de la niche aux titres les plus proches
 * (plus proches voisins sur les embeddings), et contrôles de forme.
 *
 * Idée : un titre proche de titres qui ont sur-performé a plus de chances de sur-performer.
 * Le « multiple » est la moyenne géométrique pondérée des scores de sur-performance des voisins
 * (vues de la vidéo / vues habituelles de sa chaîne au même âge), ramenée vers la moyenne de la niche
 * quand les voisins sont peu nombreux ou peu ressemblants.
 */

export interface Neighbor {
  videoId: string;
  title: string;
  channelTitle: string;
  similarity: number;
  score: number;
}

export interface TitleCheck {
  ok: boolean;
  label: string;
}

export interface TitleScore {
  title: string;
  /** Vues attendues ÷ vues habituelles (1 = comme d'habitude). null si pas assez de données. */
  multiple: number | null;
  p2x: number | null;
  p10x: number | null;
  /** 0-100 : forme du titre (lisibilité, curiosité, longueur…). */
  formScore: number;
  /** 0-100 : note globale du titre. */
  score: number;
  checks: TitleCheck[];
  /** Titres proches qui ont fait au moins 3× leurs vues habituelles. */
  winners: Neighbor[];
  /** Titres proches qui ont fait moins de la moitié. */
  losers: Neighbor[];
  evidence: number;
  /** Vidéos les plus proches (pour retrouver le sujet du titre). */
  neighborIds: string[];
}

const CURIOSITY = /\b(why|how|what|secret|truth|nobody|never|stop|mistake|actually|really|hidden|real reason|this is|you('| a)re|explained|pourquoi|comment|secret|vérité|personne|jamais|erreur|vraiment|caché)\b/i;
const EMOTION = /\b(insane|shocking|terrifying|brutal|incredible|crazy|dark|disturbing|genius|ultimate|worst|best|richest|poorest|deadliest|biggest|fou|choquant|terrifiant|incroyable|pire|meilleur)\b/i;

export function titleChecks(title: string): { checks: TitleCheck[]; formScore: number } {
  const t = title.trim();
  const len = t.length;
  const words = t.split(/\s+/).filter(Boolean);
  const capsWords = words.filter((w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w)).length;
  const checks: TitleCheck[] = [
    { ok: len >= 30 && len <= 70, label: len < 30 ? `Titre court (${len} caractères) : ajoute un enjeu ou un bénéfice.` : len > 70 ? `Titre long (${len} caractères) : coupé sur mobile au-delà de ~70.` : `Longueur idéale (${len} caractères).` },
    { ok: CURIOSITY.test(t) || /\?$/.test(t), label: CURIOSITY.test(t) || /\?$/.test(t) ? 'Crée une question dans la tête du spectateur.' : 'Pas de curiosité explicite : pose une question ou promets une révélation.' },
    { ok: /\d/.test(t), label: /\d/.test(t) ? 'Contient un chiffre concret.' : 'Pas de chiffre : un nombre (montant, durée, classement) rend la promesse concrète.' },
    { ok: EMOTION.test(t), label: EMOTION.test(t) ? 'Mot à forte émotion présent.' : 'Aucun mot fort : un superlatif ou une émotion aide à se démarquer.' },
    { ok: capsWords <= 2, label: capsWords <= 2 ? 'Majuscules dosées.' : `${capsWords} mots en majuscules : ça fait « piège à clics ».` },
    { ok: words.length >= 5, label: words.length >= 5 ? 'Assez de mots pour être compris seul.' : 'Trop peu de mots pour être compris sans la miniature.' },
  ];
  const weights = [25, 25, 15, 15, 10, 10];
  const formScore = Math.round(checks.reduce((s, c, i) => s + (c.ok ? weights[i] : 0), 0));
  return { checks, formScore };
}

function parseVec(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') return raw.replace(/^\[|\]$/g, '').split(',').map(Number);
  return [];
}

async function embedTitles(titles: string[]): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) return null;
  const res = await fetch(`${process.env.EMBEDDING_BASE_URL ?? 'https://api.voyageai.com/v1'}/embeddings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.EMBEDDING_MODEL ?? 'voyage-4-lite', input: titles, input_type: 'document' }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const j = (await res.json()) as { data?: { embedding: number[] }[] };
  return j.data?.map((d) => parseVec(d.embedding)) ?? null;
}

/** Taux de base de la niche : part des vidéos à ≥ 2× et ≥ 10×, et multiple médian. */
async function nichePrior(db: SupabaseClient, nicheIds: string[]) {
  const { data: chans } = await db.from('channels').select('id').in('niche_id', nicheIds).limit(500);
  const ids = ((chans ?? []) as { id: string }[]).map((c) => c.id);
  const scores: number[] = [];
  for (let i = 0; i < ids.length && scores.length < 3000; i += 100) {
    const { data: vids } = await db.from('videos').select('id').in('channel_id', ids.slice(i, i + 100)).limit(1000);
    const vIds = ((vids ?? []) as { id: string }[]).map((v) => v.id);
    for (let j = 0; j < vIds.length; j += 200) {
      const { data: o } = await db.from('video_outliers').select('score').in('video_id', vIds.slice(j, j + 200));
      for (const r of (o ?? []) as { score: number }[]) scores.push(Number(r.score));
    }
  }
  if (scores.length < 20) return { logMean: 0, p2x: 0.12, p10x: 0.01, n: scores.length };
  const logMean = scores.reduce((s, x) => s + Math.log(Math.min(100, Math.max(0.05, x))), 0) / scores.length;
  return {
    logMean,
    p2x: scores.filter((x) => x >= 2).length / scores.length,
    p10x: scores.filter((x) => x >= 10).length / scores.length,
    n: scores.length,
  };
}

export async function scoreTitles(db: SupabaseClient, nicheIds: string[], titles: string[]): Promise<{ scores: TitleScore[]; prior: { p2x: number; p10x: number; n: number; logMean: number } }> {
  const clean = titles.map((t) => t.trim()).filter(Boolean).slice(0, 3);
  const [vectors, prior] = await Promise.all([embedTitles(clean), nichePrior(db, nicheIds)]);

  const scores: TitleScore[] = [];
  for (let i = 0; i < clean.length; i++) {
    const title = clean[i];
    const { checks, formScore } = titleChecks(title);
    let neighbors: Neighbor[] = [];
    if (vectors?.[i]?.length) {
      const { data } = await db.rpc('match_niche_videos', {
        query_embedding: `[${vectors[i].join(',')}]`,
        niche_ids: nicheIds,
        match_count: 40,
      });
      neighbors = ((data ?? []) as { video_id: string; title: string; channel_title: string | null; similarity: number; score: number }[])
        .filter((n) => n.title && n.title.trim().toLowerCase() !== title.toLowerCase())
        .map((n) => ({ videoId: n.video_id, title: n.title, channelTitle: n.channel_title ?? '', similarity: Number(n.similarity), score: Number(n.score) }));
    }

    // Poids : seuls les vrais voisins comptent (similarité > 0,35), de plus en plus fort quand ils se ressemblent.
    let wSum = 0, logSum = 0, w2 = 0, w10 = 0;
    for (const n of neighbors) {
      const w = Math.max(0, n.similarity - 0.35) ** 2;
      if (!w) continue;
      wSum += w;
      logSum += w * Math.log(Math.min(100, Math.max(0.05, n.score)));
      if (n.score >= 2) w2 += w;
      if (n.score >= 10) w10 += w;
    }
    // Ramené vers la niche quand la preuve est faible (K = poids équivalent de la moyenne de niche).
    const K = 0.4;
    const evidence = wSum;
    const multiple = neighbors.length ? Math.exp((logSum + K * prior.logMean) / (wSum + K)) : null;
    const p2x = neighbors.length ? (w2 + K * prior.p2x) / (wSum + K) : null;
    const p10x = neighbors.length ? (w10 + K * prior.p10x) / (wSum + K) : null;

    // Note du titre : 60 % ce que disent les données (×1 → 50, ×2 → 75, ×4 → 100), 40 % la forme.
    const dataScore = multiple === null ? null : Math.max(0, Math.min(100, 50 + 25 * Math.log2(multiple)));
    const score = Math.round(dataScore === null ? formScore : 0.6 * dataScore + 0.4 * formScore);

    const close = neighbors.filter((n) => n.similarity > 0.45);
    scores.push({
      title,
      multiple: multiple === null ? null : Math.round(multiple * 100) / 100,
      p2x: p2x === null ? null : Math.round(p2x * 1000) / 1000,
      p10x: p10x === null ? null : Math.round(p10x * 1000) / 1000,
      formScore,
      score,
      checks,
      winners: close.filter((n) => n.score >= 3).sort((a, b) => b.score - a.score).slice(0, 5),
      losers: close.filter((n) => n.score < 0.5).sort((a, b) => a.score - b.score).slice(0, 3),
      evidence: Math.round(evidence * 100) / 100,
      neighborIds: neighbors.slice(0, 15).map((n) => n.videoId),
    });
  }
  return { scores, prior: { p2x: prior.p2x, p10x: prior.p10x, n: prior.n, logMean: prior.logMean } };
}

/** Vidéos qui ont le plus sur-performé dans la niche (pour la miniature et le script). */
export async function topNicheOutliers(db: SupabaseClient, nicheIds: string[], limit = 6): Promise<{ id: string; title: string; score: number }[]> {
  const { data: chans } = await db.from('channels').select('id').in('niche_id', nicheIds).limit(300);
  const ids = ((chans ?? []) as { id: string }[]).map((c) => c.id);
  if (!ids.length) return [];
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const out: { id: string; title: string; score: number }[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data: vids } = await db
      .from('videos')
      .select('id, title, duration_s')
      .in('channel_id', ids.slice(i, i + 100))
      .gte('published_at', since)
      .gte('duration_s', 240)
      .limit(1000);
    const vList = (vids ?? []) as { id: string; title: string }[];
    for (let j = 0; j < vList.length; j += 200) {
      const chunk = vList.slice(j, j + 200);
      const { data: o } = await db.from('video_outliers').select('video_id, score').in('video_id', chunk.map((v) => v.id)).gte('score', 3);
      const byId = new Map(chunk.map((v) => [v.id, v.title]));
      for (const r of (o ?? []) as { video_id: string; score: number }[]) out.push({ id: r.video_id, title: byId.get(r.video_id) ?? '', score: Number(r.score) });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
