import type { SupabaseClient } from '@supabase/supabase-js';
import { scoreTitles, topNicheOutliers, type TitleScore } from './titles';
import { scoreScript, scoreThumbnail, type ScriptScore, type ThumbnailScore } from './creative';
import { geminiEnabled } from '../ai/gemini';
import { deleteFile, fileState, scoreVideoFile, type VideoFileScore } from './video-file';
import { viewsAt, type Snap } from '../predictor/context';
import { loadModel, plannedContext, predictWithModel, probAbove, type ModelPrediction } from '../predictor/predict';

const nf = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

/**
 * Note avant publication : titres + miniature + script + vidéo finie → note globale et prédiction,
 * puis suivi après publication et recalibrage sur les résultats réels de la chaîne.
 */

export interface Prediction {
  /** Vues attendues ÷ vues habituelles de la chaîne, après ajustements. */
  multiple: number;
  p2x: number;
  p10x: number;
  expectedViews: number | null;
  baselineViews: number | null;
  /** Facteur appris sur les vidéos déjà publiées de la chaîne (1 = pas encore assez de recul). */
  calibration: { factor: number; n: number };
  basis: string;
}

export interface PreflightResult {
  overall: number;
  verdict: 'ready' | 'improve' | 'rework';
  bestTitle: string;
  titles: TitleScore[];
  thumbnail: ThumbnailScore | null;
  script: ScriptScore | null;
  video: VideoFileScore | null;
  prediction: Prediction;
  /** Ce que dit le modèle entraîné (null tant qu'il n'a pas été entraîné). */
  model: (Pick<ModelPrediction, 'trainedAt' | 'n' | 'metrics' | 'drivers'> & { topicPhase: number | null; topicRecent7d: number }) | null;
  publishAt: string;
  nichePrior: { p2x: number; p10x: number; n: number };
  errors: string[];
}

export interface PreflightInput {
  userId: string;
  userChannelId: string | null;
  nicheId: string;
  titles: string[];
  script?: string | null;
  thumbnail?: { mimeType: string; base64: string; tinyBase64?: string | null } | null;
  /** Vidéo finie, déjà envoyée à Gemini par le navigateur. */
  video?: { name: string; uri: string; mimeType: string; durationS?: number | null } | null;
  baselineViews?: number | null;
  ytChannelId?: string | null;
  publishAt?: Date | null;
}

// ── Vues à un âge donné (instantanés quotidiens) ─────────────────────

// Same rules as the model training (lib/predictor/context.ts).


const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface OwnVideo {
  id: string;
  title: string;
  publishedMs: number;
  durationS: number;
  snaps: Snap[];
}

async function loadOwnVideos(db: SupabaseClient, ytChannelId: string, limit = 40): Promise<OwnVideo[]> {
  const { data: vids } = await db
    .from('videos')
    .select('id, title, published_at, duration_s')
    .eq('channel_id', ytChannelId)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);
  const list = ((vids ?? []) as { id: string; title: string; published_at: string; duration_s: number | null }[]).filter((v) => (v.duration_s ?? 0) > 60);
  const snapsById = new Map<string, Snap[]>();
  const ids = list.map((v) => v.id);
  for (let i = 0; i < ids.length; i += 50) {
    for (let from = 0; from < 20_000; from += 1000) {
      const { data } = await db
        .from('video_snapshots')
        .select('video_id, captured_at, views')
        .in('video_id', ids.slice(i, i + 50))
        .order('captured_at', { ascending: true })
        .range(from, from + 999);
      const rows = (data ?? []) as { video_id: string; captured_at: string; views: number }[];
      for (const r of rows) snapsById.set(r.video_id, [...(snapsById.get(r.video_id) ?? []), { at: new Date(r.captured_at).getTime(), views: Number(r.views) || 0 }]);
      if (rows.length < 1000) break;
    }
  }
  return list.map((v) => ({ id: v.id, title: v.title, publishedMs: new Date(v.published_at).getTime(), durationS: v.duration_s ?? 0, snaps: snapsById.get(v.id) ?? [] }));
}

/** Vues habituelles de la chaîne au même âge, d'après les vidéos publiées avant celle-ci. */
function baselineAt(videos: OwnVideo[], before: number, ageDays: number): number | null {
  // 12 most recent measured videos (filter first, then take 12: same as the training baseline).
  const vals = videos
    .filter((v) => v.publishedMs <= before - ageDays * 86_400_000)
    .map((v) => viewsAt(v.snaps, v.publishedMs, ageDays))
    .filter((x): x is number => x !== null && x > 0)
    .slice(0, 12);
  return vals.length >= 3 ? median(vals) : null;
}

// ── Recalibrage ──────────────────────────────────────────────────────

export async function getCalibration(db: SupabaseClient, userId: string, userChannelId: string | null) {
  let q = db.from('preflight_checks').select('predicted_multiple, actual_multiple, predicted_p2x').eq('user_id', userId).not('actual_multiple', 'is', null).order('created_at', { ascending: false }).limit(30);
  if (userChannelId) q = q.eq('user_channel_id', userChannelId);
  const { data } = await q;
  const rows = ((data ?? []) as { predicted_multiple: number; actual_multiple: number; predicted_p2x: number | null }[]).filter((r) => Number(r.predicted_multiple) > 0 && Number(r.actual_multiple) > 0);
  if (rows.length < 3) return { factor: 1, n: rows.length, hits: null as null | { predictedHigh: number; actualHigh: number } };
  const logs = rows.map((r) => Math.log(Number(r.actual_multiple) / Number(r.predicted_multiple)));
  const factor = Math.min(3, Math.max(0.33, Math.exp(median(logs))));
  const high = rows.filter((r) => Number(r.predicted_p2x ?? 0) >= 0.3);
  return {
    factor: Math.round(factor * 100) / 100,
    n: rows.length,
    hits: high.length ? { predictedHigh: high.length, actualHigh: high.filter((r) => Number(r.actual_multiple) >= 2).length } : null,
  };
}

// ── Évaluation ───────────────────────────────────────────────────────

export async function runPreflight(db: SupabaseClient, input: PreflightInput): Promise<{ id: string | null; result: PreflightResult }> {
  const titles = input.titles.map((t) => t.trim()).filter(Boolean).slice(0, 3);
  const errors: string[] = [];
  const nicheIds = [input.nicheId];
  const publishAt = input.publishAt && !Number.isNaN(input.publishAt.getTime()) ? input.publishAt : new Date(Date.now() + 86_400_000);

  const [{ scores, prior, rpcError }, winners, calibration, model] = await Promise.all([
    scoreTitles(db, nicheIds, titles),
    topNicheOutliers(db, nicheIds, 8),
    getCalibration(db, input.userId, input.userChannelId),
    loadModel(db),
  ]);

  if (rpcError) errors.push(rpcError);
  const best = [...scores].sort((a, b) => b.score - a.score)[0];
  let thumbnail: ThumbnailScore | null = null;
  let script: ScriptScore | null = null;
  let video: VideoFileScore | null = null;
  if (geminiEnabled()) {
    const tasks: Promise<void>[] = [];
    if (input.thumbnail) {
      tasks.push(
        scoreThumbnail(db, input.thumbnail, best.title, winners)
          .then((r) => void (thumbnail = r))
          .catch((e) => void errors.push(`Miniature : ${(e as Error).message.slice(0, 160)}`)),
      );
    }
    if (input.script && input.script.trim().split(/\s+/).length >= 40) {
      tasks.push(
        scoreScript(db, input.script, best.title, winners.map((w) => w.id))
          .then((r) => void (script = r))
          .catch((e) => void errors.push(`Script : ${(e as Error).message.slice(0, 160)}`)),
      );
    }
    if (input.video) {
      const vf = input.video;
      tasks.push(
        // Duration read server-side from Google (the browser value is only a fallback).
        fileState(vf.name)
          .then((st) => scoreVideoFile(db, { uri: vf.uri, mimeType: vf.mimeType }, best.title, st.durationS ?? vf.durationS ?? null))
          .then((r) => void (video = r))
          .catch((e) => void errors.push(`Vidéo : ${(e as Error).message.slice(0, 160)}`))
          .finally(() => deleteFile(vf.name)),
      );
    }
    await Promise.all(tasks);
  } else if (input.thumbnail || input.script || input.video) {
    errors.push('Miniature, script et vidéo non notés : ajoute la clé GEMINI_API_KEY.');
  }

  // Note globale : moyenne pondérée des parties évaluées.
  const th = thumbnail as ThumbnailScore | null;
  const sc = script as ScriptScore | null;
  const vd = video as VideoFileScore | null;
  const parts: [number, number][] = [[best.score, 0.3]];
  if (th) parts.push([th.score, 0.25]);
  if (sc) parts.push([sc.score, 0.15]);
  if (vd) parts.push([vd.score, 0.3]);
  const overall = Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0));

  // ── Prédiction ──
  // 1. Contexte (modèle entraîné sur toutes les vidéos suivies) : moment, chaîne, sujet, format, forme du titre.
  // 2. Ressemblance du titre avec les gagnants de la niche (écart à la moyenne de la niche).
  // 3. Qualité de la miniature, du script et du montage (×0,7 à ×1,3).
  // 4. Recalibrage sur les vidéos déjà publiées de la chaîne.
  const durationS = vd?.durationS ?? input.video?.durationS ?? (sc ? Math.round(sc.est_minutes * 60) : null);
  let modelPart: PreflightResult['model'] = null;
  let logCore: number;
  if (model) {
    const ctx = await plannedContext(db, {
      ytChannelId: input.ytChannelId ?? null,
      title: best.title,
      durationS,
      publishAt,
      neighborIds: best.neighborIds,
      fallbackBaseline: input.baselineViews ?? null,
    });
    const mp = predictWithModel(model, ctx);
    const knnDelta = best.multiple !== null ? Math.log(best.multiple) - prior.logMean : 0;
    logCore = mp.logPred + 0.6 * knnDelta;
    modelPart = { trainedAt: mp.trainedAt, n: mp.n, metrics: mp.metrics, drivers: mp.drivers, topicPhase: ctx.topicPhase, topicRecent7d: ctx.topicRecent7d };
  } else {
    logCore = Math.log(best.multiple ?? 1);
  }
  const quality = [th?.score, sc?.score, vd?.score].filter((x): x is number => typeof x === 'number');
  const q = quality.length ? quality.reduce((a, b) => a + b, 0) / quality.length / 100 : 0.5;
  const logFinal = logCore + Math.log(0.7 + 0.6 * q) + Math.log(calibration.factor);
  const multiple = Math.round(Math.exp(logFinal) * 100) / 100;
  let p2x: number;
  let p10x: number;
  if (model) {
    p2x = probAbove(model, logFinal, Math.log(2));
    p10x = probAbove(model, logFinal, Math.log(10));
  } else {
    const adj = (0.7 + 0.6 * q) * Math.sqrt(calibration.factor);
    p2x = (best.p2x ?? prior.p2x) * adj;
    p10x = (best.p10x ?? prior.p10x) * adj;
  }
  p2x = Math.min(0.95, Math.max(0.01, p2x));
  p10x = Math.min(0.5, Math.max(0.002, p10x));
  const baselineViews = input.baselineViews ?? null;

  const result: PreflightResult = {
    overall,
    verdict: overall >= 75 ? 'ready' : overall >= 55 ? 'improve' : 'rework',
    bestTitle: best.title,
    titles: scores,
    thumbnail: th,
    script: sc,
    video: vd,
    prediction: {
      multiple,
      p2x: Math.round(p2x * 1000) / 1000,
      p10x: Math.round(p10x * 1000) / 1000,
      expectedViews: baselineViews ? Math.round(baselineViews * multiple) : null,
      baselineViews,
      calibration: { factor: calibration.factor, n: calibration.n },
      basis: model
        ? `Modèle entraîné sur ${nf(model.n)} vidéos suivies par TubLyTI, plus la ressemblance du titre avec les gagnants de ta niche.`
        : best.multiple === null
          ? 'Pas encore assez de vidéos comparables dans la niche : estimation sur la moyenne de la niche.'
          : `Basé sur les vidéos de la niche aux titres les plus proches (poids de preuve ${best.evidence}). Le modèle complet s’activera après son premier entraînement.`,
    },
    model: modelPart,
    publishAt: publishAt.toISOString(),
    nichePrior: { p2x: prior.p2x, p10x: prior.p10x, n: prior.n },
    errors,
  };

  const { data: row } = await db
    .from('preflight_checks')
    .insert({
      user_id: input.userId,
      user_channel_id: input.userChannelId,
      niche_id: input.nicheId,
      title: best.title,
      titles,
      has_thumbnail: Boolean(input.thumbnail),
      has_script: Boolean(sc),
      result,
      overall_score: overall,
      predicted_multiple: multiple,
      predicted_p2x: result.prediction.p2x,
    })
    .select('id')
    .single();

  return { id: (row?.id as string | undefined) ?? null, result };
}

// ── Après publication : rattachement, mesure, suivi ──────────────────

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

function titleSimilarity(a: string, b: string): number {
  const A = new Set(norm(a));
  const B = new Set(norm(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

export interface FollowRow {
  videoId: string;
  title: string;
  ageDays: number;
  views: number;
  baseline: number | null;
  multiple: number | null;
  status: 'above' | 'normal' | 'below' | 'unknown';
  ctr: number | null;
  advice: string;
}

export interface CheckRow {
  id: string;
  createdAt: string;
  title: string;
  overall: number | null;
  predictedMultiple: number | null;
  predictedP2x: number | null;
  videoId: string | null;
  videoTitle: string | null;
  actualMultiple: number | null;
  pendingDays: number | null;
}

/**
 * Met à jour les prédictions passées (rattachement automatique par titre, mesure à 7 jours)
 * et calcule le suivi des vidéos récentes. Appelé au chargement de la page : aucune étape de nuit en plus.
 */
export async function refreshAndFollow(db: SupabaseClient, userId: string, userChannelId: string, ytChannelId: string | null) {
  const videos = ytChannelId ? await loadOwnVideos(db, ytChannelId) : [];
  const now = Date.now();

  const { data: checksRaw } = await db
    .from('preflight_checks')
    .select('id, created_at, title, titles, overall_score, predicted_multiple, predicted_p2x, video_id, actual_multiple')
    .eq('user_id', userId)
    .eq('user_channel_id', userChannelId)
    .order('created_at', { ascending: false })
    .limit(30);
  const checks = (checksRaw ?? []) as {
    id: string; created_at: string; title: string; titles: string[]; overall_score: number | null;
    predicted_multiple: number | null; predicted_p2x: number | null; video_id: string | null; actual_multiple: number | null;
  }[];

  const linkedIds = new Set(checks.map((c) => c.video_id).filter(Boolean));
  for (const c of checks) {
    // 1. Rattachement automatique : vidéo publiée après l'évaluation, au titre très proche.
    if (!c.video_id && now - new Date(c.created_at).getTime() < 60 * 86_400_000) {
      const created = new Date(c.created_at).getTime() - 86_400_000;
      const cands = videos
        .filter((v) => v.publishedMs >= created && !linkedIds.has(v.id))
        .map((v) => ({ v, sim: Math.max(...[c.title, ...(c.titles ?? [])].map((t) => titleSimilarity(t, v.title))) }))
        .filter((x) => x.sim >= 0.6)
        .sort((a, b) => b.sim - a.sim);
      if (cands[0]) {
        c.video_id = cands[0].v.id;
        linkedIds.add(c.video_id);
        await db.from('preflight_checks').update({ video_id: c.video_id, linked_at: new Date().toISOString() }).eq('id', c.id);
      }
    }
    // 2. Mesure à 7 jours, une seule fois.
    if (c.video_id && c.actual_multiple === null) {
      const v = videos.find((x) => x.id === c.video_id);
      if (v && now - v.publishedMs >= 7 * 86_400_000) {
        const views7 = viewsAt(v.snaps, v.publishedMs, 7);
        const base7 = baselineAt(videos, v.publishedMs, 7);
        if (views7 !== null && base7) {
          const m = Math.round((views7 / base7) * 100) / 100;
          c.actual_multiple = m;
          await db
            .from('preflight_checks')
            .update({ actual: { views_7d: views7, baseline_7d: base7, multiple_7d: m, measured_at: new Date().toISOString() }, actual_multiple: m })
            .eq('id', c.id);
        }
      }
    }
  }

  // 3. Suivi des vidéos des 21 derniers jours.
  const recent = videos.filter((v) => now - v.publishedMs <= 21 * 86_400_000).slice(0, 10);
  const ctrById = new Map<string, number>();
  if (recent.length) {
    const { data } = await db.from('video_reach_daily').select('video_id, impressions, ctr').eq('user_channel_id', userChannelId).in('video_id', recent.map((v) => v.id));
    const agg = new Map<string, { imp: number; clicks: number }>();
    for (const r of (data ?? []) as { video_id: string; impressions: number; ctr: number | null }[]) {
      const a = agg.get(r.video_id) ?? { imp: 0, clicks: 0 };
      a.imp += Number(r.impressions) || 0;
      a.clicks += (Number(r.impressions) || 0) * (Number(r.ctr) || 0);
      agg.set(r.video_id, a);
    }
    for (const [id, a] of agg) if (a.imp > 0) ctrById.set(id, a.clicks / a.imp);
  }
  const follow: FollowRow[] = recent.map((v) => {
    const ageDays = Math.max(0, (now - v.publishedMs) / 86_400_000);
    const views = v.snaps.length ? v.snaps[v.snaps.length - 1].views : 0;
    const age = Math.max(1, Math.round(ageDays));
    const baseline = baselineAt(videos, v.publishedMs, age);
    const multiple = baseline ? Math.round((views / baseline) * 100) / 100 : null;
    const status: FollowRow['status'] = multiple === null ? 'unknown' : multiple >= 1.5 ? 'above' : multiple >= 0.7 ? 'normal' : 'below';
    const ctr = ctrById.get(v.id) ?? null;
    let advice: string;
    if (status === 'above') advice = 'Elle décolle : prépare vite une suite ou un sujet proche, et réponds aux commentaires pour entretenir l’élan.';
    else if (status === 'below' && ctr !== null && ctr < 0.04) advice = `CTR faible (${(ctr * 100).toFixed(1)} %) : change la miniature ou le titre avec « Tester et comparer » de YouTube Studio : d’abord 3 miniatures très différentes, puis 3 petites variantes de la gagnante.`;
    else if (status === 'below' && ctr !== null) advice = `Les gens cliquent (CTR ${(ctr * 100).toFixed(1)} %) mais YouTube ne pousse pas : regarde la rétention dans Ma chaîne et analyse la vidéo pour trouver le décrochage.`;
    else if (status === 'below') advice = 'En dessous de tes vues habituelles à cet âge : vérifie d’abord la miniature et le titre, puis la rétention des 30 premières secondes.';
    else if (status === 'normal') advice = 'Dans tes vues habituelles.';
    else advice = 'Pas encore assez d’historique à cet âge pour comparer.';
    return { videoId: v.id, title: v.title, ageDays: Math.round(ageDays * 10) / 10, views, baseline, multiple, status, ctr, advice };
  });

  const titleById = new Map(videos.map((v) => [v.id, v.title]));
  const checkRows: CheckRow[] = checks.map((c) => {
    const v = c.video_id ? videos.find((x) => x.id === c.video_id) : null;
    return {
      id: c.id,
      createdAt: c.created_at,
      title: c.title,
      overall: c.overall_score,
      predictedMultiple: c.predicted_multiple === null ? null : Number(c.predicted_multiple),
      predictedP2x: c.predicted_p2x === null ? null : Number(c.predicted_p2x),
      videoId: c.video_id,
      videoTitle: c.video_id ? titleById.get(c.video_id) ?? null : null,
      actualMultiple: c.actual_multiple === null ? null : Number(c.actual_multiple),
      pendingDays: v && c.actual_multiple === null ? Math.max(0, Math.ceil(7 - (now - v.publishedMs) / 86_400_000)) : null,
    };
  });

  const linkable = videos
    .filter((v) => !linkedIds.has(v.id) && now - v.publishedMs <= 60 * 86_400_000)
    .slice(0, 20)
    .map((v) => ({ id: v.id, title: v.title }));

  return { follow, checks: checkRows, linkable };
}
