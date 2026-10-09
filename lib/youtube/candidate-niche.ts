/**
 * Chaînes candidates : niche détectée automatiquement + décision automatique (ajout ou refus).
 *
 * 1. Lecture : abonnés, 30 dernières vidéos (titres, durées, vues). 2 à 3 unités de quota par chaîne.
 *    « Vidéo longue » = tout ce qui n'est pas un Short (plus de 3 min). Les grosses chaînes
 *    (≥ 100 000 abonnés ou ≥ 50 000 vues habituelles) ne sont jamais écartées pour leur format.
 * 2. Niche : moyenne des embeddings des titres, comparée au « centre » de chaque niche suivie
 *    (moyenne des titres des vidéos déjà collectées dans cette niche). La niche la plus proche est retenue.
 * 3. Seuils calibrés chaque nuit sur les chaînes déjà au catalogue : une candidate est acceptée si elle
 *    ressemble à sa niche au moins autant que la plupart des chaînes déjà suivies dans cette niche.
 * 4. Décision : acceptée (ajoutée au catalogue) ou refusée, avec une raison lisible. Plus de tri manuel.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '../providers/embeddings';
import { classifyWithAI, aiClassifyEnabled } from './niche-ai';
import { createNichesFromUnmatched, type NicheCreateResult, type UnmatchedChannel } from './niche-create';

const YT = 'https://www.googleapis.com/youtube/v3';
// Réglages (surchargés par variables d'environnement)
/** Au-delà de cette durée, une vidéo n'est pas un Short (YouTube : Shorts jusqu'à 3 min). */
const LONG_S = Number(process.env.CANDIDATE_LONG_MIN_SECONDS ?? 180);
/** Nombre de dernières vidéos lues par chaîne (1 unité de quota quelle que soit la valeur, 50 au plus). */
const RECENT = Math.min(50, Number(process.env.CANDIDATE_RECENT_VIDEOS ?? 30));
const MIN_SUBS = Number(process.env.CANDIDATE_MIN_SUBS ?? 5_000);
const MIN_MEDIAN = Number(process.env.CANDIDATE_MIN_MEDIAN_VIEWS ?? 2_000);
/** Vidéos qui ne sont pas des Shorts, parmi les RECENT dernières. */
const MIN_LONG = Number(process.env.CANDIDATE_MIN_LONG_VIDEOS ?? 2);
const MIN_MARGIN = Number(process.env.CANDIDATE_MIN_MARGIN ?? 0.02);
/** Grosse chaîne : plus de règle de format, et une ressemblance de niche un peu moins exigeante. */
const BIG_SUBS = Number(process.env.CANDIDATE_BIG_SUBS ?? 100_000);
const BIG_MEDIAN = Number(process.env.CANDIDATE_BIG_MEDIAN_VIEWS ?? 50_000);
/** Une chaîne écartée pour sa taille ou son format est relue après ce délai (elle a pu grossir). */
const RECHECK_DAYS = Number(process.env.CANDIDATE_RECHECK_DAYS ?? 30);

export interface NicheCentroid {
  id: string;
  name: string;
  vec: number[];
}
export interface Calibration {
  acceptSim: number;
  rejectSim: number;
  sample: number;
}
export interface CandidateRunResult {
  read: number;
  detected: number;
  accepted: number;
  rejected: number;
  /** Hors des niches suivies, gardées pour créer une nouvelle niche. */
  unmatched: number;
  niches: NicheCreateResult | null;
  promoted: number;
  quotaUsed: number;
  calibration: Calibration;
  decisions: { id: string; title: string | null; decision: 'accepted' | 'rejected' | 'unmatched'; niche: string | null; reason: string }[];
}

/* ---------- vecteurs ---------- */

export function parseVec(raw: unknown): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
  }
  return [];
}
function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
function sum(vs: number[][]): number[] {
  const out = new Array(vs[0]?.length ?? 0).fill(0);
  for (const v of vs) for (let i = 0; i < out.length; i++) out[i] += v[i];
  return out;
}
export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * (s.length - 1))))];
}
const fmt = (x: number) => `${Math.round(x * 100)} %`;

/* ---------- centres des niches + calibration ---------- */

/**
 * Centre de chaque niche active (200 vidéos récentes déjà analysées) et seuils calibrés :
 * pour chaque chaîne du catalogue bien représentée, similarité de ses titres avec le centre de sa niche
 * (calculé sans elle). Seuil d'acceptation = 20e centile ; seuil de refus = 8 points plus bas.
 */
export async function loadNicheCentroids(db: SupabaseClient, perNiche = 200): Promise<{ centroids: NicheCentroid[]; calibration: Calibration }> {
  const { data: niches } = await db.from('niches').select('id, name').eq('status', 'active');
  const centroids: NicheCentroid[] = [];
  const sims: number[] = [];
  for (const n of (niches ?? []) as { id: string; name: string }[]) {
    // Deux requêtes simples plutôt qu'une jointure triée (trop lente sur la table des vidéos) :
    // les chaînes de la niche, puis des vidéos déjà analysées de ces chaînes.
    const { data: chans, error: chErr } = await db.from('channels').select('id').eq('niche_id', n.id).eq('status', 'active').limit(120);
    if (chErr) console.error(`  centre de « ${n.name} » : ${chErr.message}`);
    const chanIds = ((chans ?? []) as { id: string }[]).map((c) => c.id);
    let rows: unknown[] | null = [];
    if (chanIds.length) {
      const r = await db.from('videos').select('channel_id, title_embedding').in('channel_id', chanIds).not('title_embedding', 'is', null).limit(perNiche);
      if (r.error) console.error(`  vidéos de « ${n.name} » : ${r.error.message}`);
      rows = r.data;
    }
    const vids = ((rows ?? []) as { channel_id: string; title_embedding: unknown }[])
      .map((r) => ({ ch: r.channel_id, v: parseVec(r.title_embedding) }))
      .filter((r) => r.v.length > 0);
    if (vids.length < 20) {
      // Niche récente (créée automatiquement) : son centre vient des chaînes qui l'ont fait naître.
      const { data: seeds } = await db.from('candidate_channels').select('embedding').eq('niche_id', n.id).not('embedding', 'is', null).limit(50);
      const vs = ((seeds ?? []) as { embedding: unknown }[]).map((x) => parseVec(x.embedding)).filter((v) => v.length);
      if (vs.length) centroids.push({ id: n.id, name: n.name, vec: normalize(sum(vs)) });
      continue;
    }
    const total = sum(vids.map((r) => r.v));
    centroids.push({ id: n.id, name: n.name, vec: normalize(total) });

    // Calibration « sans elle » : on retire la contribution de la chaîne avant de comparer.
    const byChannel = new Map<string, number[][]>();
    for (const r of vids) byChannel.set(r.ch, [...(byChannel.get(r.ch) ?? []), r.v]);
    for (const vs of byChannel.values()) {
      if (vs.length < 5 || vs.length > vids.length * 0.5) continue;
      const own = sum(vs);
      const rest = total.map((x, i) => x - own[i]);
      sims.push(cosine(normalize(own), normalize(rest)));
    }
  }
  const fallbackAccept = Number(process.env.CANDIDATE_ACCEPT_SIM ?? 0.72);
  const fallbackReject = Number(process.env.CANDIDATE_REJECT_SIM ?? 0.6);
  if (sims.length < 10) return { centroids, calibration: { acceptSim: fallbackAccept, rejectSim: fallbackReject, sample: sims.length } };
  const acceptSim = Math.min(0.9, Math.max(0.55, percentile(sims, 20)));
  return { centroids, calibration: { acceptSim, rejectSim: Math.max(0.4, acceptSim - 0.08), sample: sims.length } };
}

export function detectNiche(vec: number[], centroids: NicheCentroid[]) {
  const scored = centroids.map((c) => ({ id: c.id, name: c.name, sim: cosine(vec, c.vec) })).sort((a, b) => b.sim - a.sim);
  const best = scored[0] ?? null;
  const second = scored[1]?.sim ?? 0;
  return { best, margin: best ? best.sim - second : 0, scored };
}

/* ---------- lecture YouTube ---------- */

async function yt<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY manquante');
  const url = new URL(`${YT}/${endpoint}`);
  url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`YouTube ${endpoint} ${res.status}`);
  return res.json() as Promise<T>;
}
function seconds(iso: string) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}
function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}

interface Candidate {
  id: string;
  title: string | null;
  subscriber_count: number | null;
  median_views: number | null;
  long_video_count: number | null;
  videos_per_month: number | null;
  recent_titles: string[] | null;
  description?: string | null;
  keywords?: string | null;
  topic_categories?: string[] | null;
  profile_text?: string | null;
  niche_id: string | null;
  niche_source: string | null;
}

/** Abonnés, titres, durées et vues des 10 dernières vidéos. */
async function readCandidates(cands: Candidate[]): Promise<{ quota: number; updates: Map<string, Partial<Candidate> & { uploads?: string | null }> }> {
  const updates = new Map<string, Partial<Candidate> & { uploads?: string | null }>();
  let quota = 0;
  for (let i = 0; i < cands.length; i += 50) {
    const batch = cands.slice(i, i + 50);
    // Même coût (1 unité par lot de 50) avec la description, les mots-clés et les catégories YouTube de la chaîne.
    const ch = await yt<{
      items?: {
        id: string;
        snippet?: { title?: string; description?: string; country?: string; defaultLanguage?: string };
        statistics?: { subscriberCount?: string };
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
        topicDetails?: { topicCategories?: string[] };
        brandingSettings?: { channel?: { keywords?: string } };
      }[];
    }>('channels', { part: 'snippet,statistics,contentDetails,topicDetails,brandingSettings', id: batch.map((c) => c.id).join(','), maxResults: '50' }).catch(() => ({ items: [] }));
    quota += 1;
    for (const it of ch.items ?? []) {
      updates.set(it.id, {
        title: it.snippet?.title ?? null,
        subscriber_count: Number(it.statistics?.subscriberCount ?? 0),
        uploads: it.contentDetails?.relatedPlaylists?.uploads ?? `UU${it.id.slice(2)}`,
        description: (it.snippet?.description ?? '').slice(0, 1500) || null,
        keywords: (it.brandingSettings?.channel?.keywords ?? '').slice(0, 500) || null,
        // « https://en.wikipedia.org/wiki/Food » → « Food »
        topic_categories: (it.topicDetails?.topicCategories ?? []).map((u) => decodeURIComponent(u.split('/').pop() ?? '').replace(/_/g, ' ')).filter(Boolean),
      });
    }
  }
  for (const c of cands) {
    const u = updates.get(c.id);
    if (!u?.uploads) continue;
    try {
      const pl = await yt<{ items?: { snippet?: { title?: string }; contentDetails?: { videoId?: string } }[] }>('playlistItems', {
        part: 'contentDetails',
        playlistId: u.uploads,
        maxResults: String(RECENT),
      });
      quota += 1;
      const ids = (pl.items ?? []).map((x) => x.contentDetails?.videoId).filter((x): x is string => Boolean(x));
      if (ids.length) {
        const v = await yt<{ items?: { snippet?: { title?: string; publishedAt?: string; description?: string; tags?: string[] }; contentDetails?: { duration?: string }; statistics?: { viewCount?: string } }[] }>('videos', {
          part: 'snippet,contentDetails,statistics',
          id: ids.join(','),
          maxResults: '50',
        });
        quota += 1;
        const vids = (v.items ?? []).map((x) => ({
          title: x.snippet?.title ?? '',
          long: seconds(x.contentDetails?.duration ?? '') > LONG_S,
          views: Number(x.statistics?.viewCount ?? 0),
          at: new Date(x.snippet?.publishedAt ?? Date.now()).getTime(),
          description: (x.snippet?.description ?? '').split('\n').filter((l) => l.trim() && !/https?:\/\//.test(l)).slice(0, 3).join(' ').slice(0, 300),
          tags: x.snippet?.tags ?? [],
        }));
        // Rythme de publication : nombre de vidéos lues ramené à 30 jours.
        if (vids.length >= 2) {
          const span = Math.max(1, (Math.max(...vids.map((x) => x.at)) - Math.min(...vids.map((x) => x.at))) / 86_400_000);
          u.videos_per_month = Math.round((vids.length / span) * 30 * 10) / 10;
        }
        const longs = vids.filter((x) => x.long);
        u.long_video_count = longs.length;
        // Vues habituelles : sur les vidéos hors Shorts quand il y en a assez (les Shorts faussent la médiane).
        u.median_views = median((longs.length >= 3 ? longs : vids).map((x) => x.views));
        // Titres pour la niche : hors Shorts d'abord, puis le reste, 15 au plus.
        u.recent_titles = [...longs, ...vids.filter((x) => !x.long)].map((x) => x.title).filter(Boolean).slice(0, 15);
        // Profil complet : description et mots-clés de la chaîne, catégories YouTube, tags fréquents,
        // début des descriptions des vidéos récentes (les transcriptions ne sont pas accessibles par l'API officielle).
        const tagCount = new Map<string, number>();
        for (const x of vids) for (const t of x.tags) tagCount.set(t.toLowerCase(), (tagCount.get(t.toLowerCase()) ?? 0) + 1);
        const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t]) => t);
        u.profile_text = [
          `Channel: ${u.title ?? ''}`,
          u.description ? `About: ${u.description.slice(0, 800)}` : '',
          u.keywords ? `Keywords: ${u.keywords}` : '',
          u.topic_categories?.length ? `YouTube topics: ${u.topic_categories.join(', ')}` : '',
          topTags.length ? `Frequent tags: ${topTags.join(', ')}` : '',
          `Recent titles: ${u.recent_titles.join(' | ')}`,
          `Video descriptions: ${[...longs, ...vids].slice(0, 5).map((x) => x.description).filter(Boolean).join(' || ')}`,
        ].filter(Boolean).join('\n').slice(0, 4000);
      }
    } catch {
      // chaîne sans vidéo publique ou erreur passagère : on réessaiera la nuit suivante
    }
  }
  return { quota, updates };
}

/* ---------- traitement ---------- */

/**
 * Lit, classe et décide pour les chaînes candidates en attente.
 * dryRun : calcule et renvoie les décisions sans rien écrire (le quota YouTube et les embeddings sont quand même utilisés).
 */
export async function classifyCandidates(
  db: SupabaseClient,
  embedder: EmbeddingProvider,
  opts: { limit?: number; deadline?: number; dryRun?: boolean } = {},
): Promise<CandidateRunResult> {
  const limit = opts.limit ?? 150;
  const deadline = opts.deadline ?? Date.now() + 15 * 60_000;
  const { centroids, calibration } = await loadNicheCentroids(db);
  const result: CandidateRunResult = { read: 0, detected: 0, accepted: 0, rejected: 0, unmatched: 0, niches: null, promoted: 0, quotaUsed: 0, calibration, decisions: [] };
  const fresh: UnmatchedChannel[] = [];
  // Sans niche de référence, rien ne peut être décidé : l'erreur apparaît dans l'historique de la collecte.
  if (!centroids.length) throw new Error('aucune niche de référence chargée (vidéos analysées introuvables pour les niches actives)');
  console.log(`  ${centroids.length} niches de référence, seuils ${Math.round(calibration.acceptSim * 100)} % / ${Math.round(calibration.rejectSim * 100)} % (${calibration.sample} chaînes)`);
  const nicheName = new Map(centroids.map((c) => [c.id, c.name]));

  // 1) en attente ; 2) écartées pour leur taille ou leur format il y a plus de RECHECK_DAYS jours ;
  // 3) hors niche : comparées de nouveau aux niches (une niche a pu être créée entre-temps), sans relecture YouTube.
  const COLS = 'id, title, subscriber_count, median_views, long_video_count, videos_per_month, recent_titles, profile_text, niche_id, niche_source, status, auto_reason';
  const recheckBefore = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const [pendingRes, recheckRes, unmatchedRes] = await Promise.all([
    db.from('candidate_channels').select(COLS).eq('status', 'pending').order('created_at', { ascending: true }).limit(limit),
    db.from('candidate_channels').select(COLS).eq('status', 'rejected').lt('decided_at', recheckBefore).not('auto_reason', 'like', 'Contenu trop éloigné%').not('auto_reason', 'like', 'Hors des niches suivies%').limit(Math.ceil(limit / 3)),
    db.from('candidate_channels').select(`${COLS}, embedding, ai_niche`).eq('status', 'unmatched').limit(500),
  ]);
  if (pendingRes.error) throw new Error(`candidate_channels : ${pendingRes.error.message} (migrations 00024 à 00026 lancées ?)`);
  type Row = Candidate & { status: string; auto_reason: string | null; embedding?: unknown };
  const cands = [
    ...((pendingRes.data ?? []) as Row[]),
    ...((recheckRes.data ?? []) as Row[]).map((c) => ({ ...c, recent_titles: null })), // relue entièrement
    ...((unmatchedRes.data ?? []) as Row[]),
  ];
  if (!cands.length) return result;

  // 1. Lecture YouTube pour celles à qui il manque des données
  // Relue si une donnée manque, y compris le profil complet (description, mots-clés, catégories) pour les chaînes à classer.
  const missing = cands.filter((c) => c.subscriber_count === null || !c.recent_titles?.length || c.long_video_count === null || !c.profile_text);
  if (missing.length) {
    const { quota, updates } = await readCandidates(missing);
    result.quotaUsed += quota;
    for (const c of missing) {
      const u = updates.get(c.id);
      if (!u) continue;
      Object.assign(c, { ...u, uploads: undefined });
      result.read++;
      if (!opts.dryRun) {
        await db
          .from('candidate_channels')
          .update({
            title: c.title, subscriber_count: c.subscriber_count, median_views: c.median_views, long_video_count: c.long_video_count,
            videos_per_month: c.videos_per_month, recent_titles: c.recent_titles,
            description: c.description ?? null, keywords: c.keywords ?? null, topic_categories: c.topic_categories ?? null, profile_text: c.profile_text ?? null,
          })
          .eq('id', c.id);
      }
    }
  }

  // 2. Niche et décision
  const useAI = aiClassifyEnabled();
  // Toutes les niches actives, même celles qui n'ont pas encore assez de vidéos pour un centre.
  const { data: allNiches } = await db.from('niches').select('id, name').eq('status', 'active');
  const nicheList = ((allNiches ?? []) as { id: string; name: string }[]);
  for (const n of nicheList) if (!nicheName.has(n.id)) nicheName.set(n.id, n.name);
  for (const c of cands) {
    if (Date.now() >= deadline) break;
    const titles = (c.recent_titles ?? []).filter((t) => t.length > 3);
    if (titles.length < 3) {
      // Pas assez de vidéos publiques pour juger : refus seulement si la chaîne a bien été lue.
      if (c.subscriber_count !== null && c.recent_titles) {
        await decide(db, result, c, 'rejected', c.niche_id, 'Moins de 3 vidéos publiques : impossible de juger son contenu.', opts.dryRun);
      }
      continue;
    }
    // Vecteur de la chaîne : titres (60 %) + profil complet (40 %) — description, mots-clés, catégories, tags, descriptions de vidéos.
    let vec: number[] = c.status === 'unmatched' && c.profile_text ? parseVec(c.embedding) : [];
    if (!vec.length) {
      try {
        const texts = [...titles.slice(0, 15), ...(c.profile_text ? [c.profile_text] : [])];
        const embs = await embedder.embed(texts, 'document');
        const t = normalize(sum(embs.slice(0, Math.min(15, titles.length))));
        const p = c.profile_text ? normalize(embs[embs.length - 1]) : t;
        vec = normalize(t.map((x, k) => 0.6 * x + 0.4 * p[k]));
      } catch {
        continue;
      }
    }
    const { best, margin, scored } = detectNiche(vec, centroids);
    if (!best) continue;
    result.detected++;

    const manual = c.niche_source === 'manual' && c.niche_id;
    let nicheId = manual ? c.niche_id : best.id;
    let nicheSim = manual ? cosine(vec, centroids.find((x) => x.id === c.niche_id)?.vec ?? []) : best.sim;
    let source: 'manual' | 'detected' | 'ai' = manual ? 'manual' : 'detected';

    // Avis de l'IA (si activé) : lit tout le profil et choisit une niche existante ou en propose une nouvelle.
    let ai: Awaited<ReturnType<typeof classifyWithAI>> = null;
    if (useAI && !manual && c.profile_text) {
      ai = await classifyWithAI(db, c.profile_text, nicheList, scored.slice(0, 5).map((x) => x.name));
      if (ai?.nicheId) {
        nicheId = ai.nicheId;
        nicheSim = cosine(vec, centroids.find((x) => x.id === ai!.nicheId)?.vec ?? []);
        source = 'ai';
      }
    }

    if (!opts.dryRun) {
      await db
        .from('candidate_channels')
        .update({
          embedding: `[${vec.join(',')}]`,
          niche_id: nicheId,
          niche_source: source,
          niche_confidence: nicheSim,
          niche_margin: margin,
          embedding_similarity: nicheSim,
          niche_checked_at: new Date().toISOString(),
          ...(ai
            ? { ai_niche: ai.newNiche?.name ?? ai.nicheName, ai_category: ai.newNiche?.category ?? null, ai_rpm_low: ai.newNiche?.rpmLow ?? null, ai_rpm_high: ai.newNiche?.rpmHigh ?? null, ai_confidence: ai.confidence, ai_reason: ai.reason }
            : {}),
        })
        .eq('id', c.id);
    }

    const subs = c.subscriber_count ?? 0;
    const med = c.median_views ?? 0;
    const longs = c.long_video_count ?? 0;
    const label = nicheName.get(nicheId ?? '') ?? '—';
    const size = `${subs.toLocaleString('fr-FR')} abonnés, ${med.toLocaleString('fr-FR')} vues habituelles, ${longs}/${RECENT} vidéos hors Shorts`;
    const big = subs >= BIG_SUBS || med >= BIG_MEDIAN;
    const sizeOk = subs >= MIN_SUBS || med >= MIN_MEDIAN;
    const keepForNewNiche = (why: string) => {
      fresh.push({ id: c.id, title: c.title, vec, titles, subs, aiNiche: ai?.newNiche ?? null });
      return decide(db, result, c, 'unmatched', null, why, opts.dryRun);
    };

    // Toutes les niches comptent : une chaîne n'est jamais écartée pour son sujet, seulement pour sa taille ou son format.
    if (!sizeOk) {
      await decide(db, result, c, 'rejected', nicheId, `Trop petite pour servir de référence : ${size}.`, opts.dryRun);
    } else if (!big && longs < MIN_LONG) {
      await decide(db, result, c, 'rejected', nicheId, `Presque uniquement des Shorts : ${longs}/${RECENT} vidéos de plus de 3 min.`, opts.dryRun);
    } else if (ai?.newNiche) {
      if (c.status === 'unmatched') continue;
      await keepForNewNiche(`Niche nouvelle selon l'IA : « ${ai.newNiche.name} » (${ai.reason}). Créée dès qu'une autre chaîne la rejoint${big ? ', ou tout de suite pour une grosse chaîne' : ''}.`);
    } else if (ai?.nicheId) {
      await decide(db, result, c, 'accepted', nicheId, `Niche « ${label} » choisie par l'IA (${ai.reason}) ; ${size}.`, opts.dryRun);
    } else if (manual || (nicheSim >= calibration.acceptSim && margin >= MIN_MARGIN)) {
      await decide(db, result, c, 'accepted', nicheId, `${big ? 'Grosse chaîne, ' : ''}niche « ${label} » détectée à ${fmt(nicheSim)} (seuil ${fmt(calibration.acceptSim)}) ; ${size}.`, opts.dryRun);
    } else if (c.status === 'unmatched') {
      continue; // toujours sans niche nette : reste dans la réserve, regroupée plus bas
    } else {
      const why = margin < MIN_MARGIN ? `hésite entre plusieurs niches (écart ${fmt(margin)})` : `la plus proche, « ${label} », n'est qu'à ${fmt(nicheSim)}`;
      await keepForNewNiche(`Pas de niche existante assez nette (${why}) : en attente de chaînes semblables pour créer une niche.`);
    }
  }

  // 3. Nouvelles niches à partir des chaînes hors niche (celles de cette nuit + celles en attente)
  try {
    result.niches = await createNichesFromUnmatched(db, calibration, fresh, { dryRun: opts.dryRun });
  } catch (e) {
    console.error(`  niches automatiques : ${(e as Error).message}`);
  }

  // 4. Ajout au catalogue des chaînes acceptées
  if (!opts.dryRun) result.promoted = await promoteAccepted(db);
  return result;
}

async function decide(
  db: SupabaseClient,
  result: CandidateRunResult,
  c: Candidate,
  decision: 'accepted' | 'rejected' | 'unmatched',
  nicheId: string | null,
  reason: string,
  dryRun?: boolean,
) {
  result[decision]++;
  result.decisions.push({ id: c.id, title: c.title, decision, niche: nicheId, reason });
  if (dryRun) return;
  await db
    .from('candidate_channels')
    .update({ status: decision, auto_decision: decision === 'unmatched' ? null : decision, auto_reason: reason, decided_at: new Date().toISOString() })
    .eq('id', c.id);
}

/** Chaînes acceptées → catalogue analysé chaque nuit. */
export async function promoteAccepted(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('candidate_channels').select('id, title, subscriber_count, niche_id').eq('status', 'accepted');
  let promoted = 0;
  for (const c of (data ?? []) as { id: string; title: string | null; subscriber_count: number | null; niche_id: string | null }[]) {
    if (!c.niche_id) continue;
    const { data: existing } = await db.from('channels').select('id, niche_id').eq('id', c.id).maybeSingle();
    if (existing && existing.niche_id !== c.niche_id) {
      // Chaîne déjà suivie, reclassée : elle change de niche.
      await db.from('channels').update({ niche_id: c.niche_id }).eq('id', c.id);
    }
    if (!existing) {
      const { error } = await db.from('channels').insert({
        id: c.id,
        workspace_id: '00000000-0000-0000-0000-000000000001',
        title: c.title,
        subscriber_count: c.subscriber_count,
        niche_id: c.niche_id,
        uploads_playlist_id: `UU${c.id.slice(2)}`,
      });
      if (error) {
        console.error(`ajout chaîne ${c.id} : ${error.message}`);
        continue;
      }
      promoted++;
    }
    await db.from('candidate_channels').update({ status: 'followed' }).eq('id', c.id);
  }
  return promoted;
}
