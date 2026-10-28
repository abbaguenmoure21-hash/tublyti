/**
 * Entraîne le modèle de prédiction des vues sur toutes les vidéos suivies par TubLyTI.
 *
 *   npx tsx scripts/train-predictor.ts            (en local, lit .env.local)
 *   GitHub → Actions → « Train predictor » (chaque dimanche, ou à la main)
 *
 * Version 2 (sans fuite de données) :
 *  - cible = log(vues à 7 jours ÷ vues habituelles à 7 jours de la chaîne), la même mesure que le
 *    résultat réel suivi après publication (lib/preflight/engine.ts) ; recalculée ici à partir des
 *    relevés, plus de `video_outliers.score` (âge quelconque, méthode « approximate ») ;
 *  - chaque paramètre est lu tel qu'il était connu à la date de publication (lib/predictor/context.ts) :
 *    vues habituelles et élan sur les vidéos précédentes déjà à 7 jours, potentiel et phase du sujet
 *    notés avant le jour de publication ; abonnés retirés (pas d'historique daté) ;
 *  - validation sur les 15 % de vidéos les plus récentes ; les résidus enregistrés viennent de ce test
 *    (et non de l'échantillon d'entraînement) ; le modèle n'est enregistré que s'il bat la base.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}

import {
  MODEL_KEY,
  MODEL_VERSION,
  fitRidge,
  predictRaw,
  probAbove,
  residualQuantiles,
  vectorize,
  type FeatureContext,
  type TrainedModel,
} from '../lib/predictor/model';
import {
  HORIZON_DAYS,
  channelContextAt,
  clampLog,
  topicScoreBefore,
  viewsAt,
  weeklyToSnaps,
  type ChannelVideo,
  type Snap,
} from '../lib/predictor/context';

const DAY = 86_400_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function all<T>(db: SupabaseClient, table: string, cols: string, order: string[], filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20_000_000; from += 1000) {
    let q = db.from(table).select(cols);
    for (const o of order) q = q.order(o);
    q = q.range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} : ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes');
  const db = createClient(url, key);

  console.log(`Chargement des données… (cible = score à ${HORIZON_DAYS} j)`);
  const [videos, scores] = await Promise.all([
    all<{ id: string; channel_id: string; topic_id: string | null; title: string | null; published_at: string | null; duration_s: number | null }>(
      db,
      'videos',
      'id, channel_id, topic_id, title, published_at, duration_s',
      ['id'],
    ),
    all<{ topic_id: string; scored_at: string; mgi: number | null; phase: number | null }>(db, 'topic_scores', 'topic_id, scored_at, mgi, phase', ['topic_id', 'scored_at']),
  ]);
  // Long videos only: the real result is measured on long videos (Shorts follow another curve).
  const vids = videos.filter((v) => v.published_at && v.title && (v.duration_s ?? 0) > 60);
  const pubById = new Map(vids.map((v) => [v.id, new Date(v.published_at!).getTime()]));

  // Only the snapshots around day 7 are kept in memory.
  const near = new Map<string, Snap[]>();
  const keepNear = (videoId: string, s: Snap) => {
    const pub = pubById.get(videoId);
    if (pub === undefined || Math.abs(s.at - (pub + HORIZON_DAYS * DAY)) > 3 * DAY) return;
    near.set(videoId, [...(near.get(videoId) ?? []), s]);
  };
  const snaps = await all<{ video_id: string; captured_at: string; views: number }>(db, 'video_snapshots', 'video_id, captured_at, views', ['video_id', 'captured_at']);
  for (const r of snaps) keepNear(r.video_id, { at: new Date(r.captured_at).getTime(), views: Number(r.views) || 0 });
  const weekly = await all<{ video_id: string; week_start: string; views: number }>(db, 'video_stats_weekly', 'video_id, week_start, views', ['video_id', 'week_start']);
  const weeklyById = new Map<string, { week_start: string; views: number }[]>();
  for (const w of weekly) weeklyById.set(w.video_id, [...(weeklyById.get(w.video_id) ?? []), w]);
  console.log(`  ${vids.length} vidéos longues, ${snaps.length} relevés, ${weekly.length} relevés hebdo, ${scores.length} notes de sujets`);

  const views7 = new Map<string, number | null>();
  let fromWeekly = 0;
  for (const v of vids) {
    const pub = pubById.get(v.id)!;
    let x = viewsAt(near.get(v.id) ?? [], pub, HORIZON_DAYS);
    if (x === null && weeklyById.has(v.id)) {
      x = viewsAt(weeklyToSnaps(weeklyById.get(v.id)!), pub, HORIZON_DAYS);
      if (x !== null) fromWeekly++;
    }
    views7.set(v.id, x);
  }

  const scoresByTopic = new Map<string, typeof scores>();
  for (const s of scores) scoresByTopic.set(s.topic_id, [...(scoresByTopic.get(s.topic_id) ?? []), s]);
  const byTopic = new Map<string, number[]>();
  for (const v of vids) if (v.topic_id) byTopic.set(v.topic_id, [...(byTopic.get(v.topic_id) ?? []), pubById.get(v.id)!]);

  const byChannel = new Map<string, typeof vids>();
  for (const v of vids) byChannel.set(v.channel_id, [...(byChannel.get(v.channel_id) ?? []), v]);

  const rows: { t: number; x: number[]; y: number }[] = [];
  for (const list of byChannel.values()) {
    const history: ChannelVideo[] = list.map((v) => ({ id: v.id, publishedMs: pubById.get(v.id)!, views7d: views7.get(v.id) ?? null }));
    for (const v of list) {
      const t = pubById.get(v.id)!;
      const y7 = views7.get(v.id);
      if (!(y7 && y7 > 0)) continue;
      const ch = channelContextAt(history, t);
      if (!ch.baselineViews) continue;
      // No value may come from after the publication (look-ahead guard).
      if (ch.latestSourceMs !== null && ch.latestSourceMs > t) throw new Error(`Fuite : la vidéo ${v.id} utilise une valeur postérieure à sa publication.`);
      const ts = v.topic_id ? topicScoreBefore(scoresByTopic.get(v.topic_id) ?? [], t) : null;
      const topicTimes = v.topic_id ? byTopic.get(v.topic_id) ?? [] : [];
      const ctx: FeatureContext = {
        durationS: v.duration_s,
        publishedAt: new Date(t),
        baselineViews: ch.baselineViews,
        momentum: ch.momentum,
        daysSincePrev: ch.daysSincePrev,
        title: v.title!,
        topicPhase: ts?.phase ?? null,
        topicMgi: ts?.mgi ?? null,
        topicRecent7d: topicTimes.filter((x) => x < t && x >= t - 7 * DAY).length,
      };
      rows.push({ t, x: vectorize(ctx), y: clampLog(y7 / ch.baselineViews) });
    }
  }
  console.log(`  ${rows.length} lignes d'entraînement (cible = score à ${HORIZON_DAYS} j ; ${fromWeekly} vues à 7 j lues dans les relevés hebdo)`);
  if (rows.length < 300) throw new Error(`Pas assez de vidéos mesurées à ${HORIZON_DAYS} j (${rows.length}) pour entraîner le modèle.`);
  rows.sort((a, b) => a.t - b.t);

  // Validation : on apprend sur le passé, on teste sur les 15 % les plus récents.
  const cut = Math.floor(rows.length * 0.85);
  const train = rows.slice(0, cut);
  const test = rows.slice(cut);
  const m0 = fitRidge(train.map((r) => r.x), train.map((r) => r.y));
  // Out-of-sample residuals: the probabilities p2x / p10x must not be over-confident.
  const testResiduals = residualQuantiles(test.map((r) => r.y - predictRaw(m0, r.x)));
  const m0t = { ...m0, residuals: testResiduals };
  const yBar = train.reduce((s, r) => s + r.y, 0) / train.length;
  let sse = 0, sst = 0, mae = 0, brier = 0, baseBrier = 0;
  const baseP2x = train.filter((r) => r.y >= Math.log(2)).length / train.length;
  for (const r of test) {
    const p = predictRaw(m0, r.x);
    sse += (r.y - p) ** 2;
    sst += (r.y - yBar) ** 2;
    mae += Math.abs(r.y - p);
    const hit = r.y >= Math.log(2) ? 1 : 0;
    brier += (probAbove(m0t, p, Math.log(2)) - hit) ** 2;
    baseBrier += (baseP2x - hit) ** 2;
  }
  const metrics = {
    testN: test.length,
    r2: Math.round((1 - sse / sst) * 1000) / 1000,
    maeLog: Math.round((mae / test.length) * 1000) / 1000,
    brierP2x: Math.round((brier / test.length) * 1000) / 1000,
    baseBrierP2x: Math.round((baseBrier / test.length) * 1000) / 1000,
    baseP2x: Math.round(baseP2x * 1000) / 1000,
    horizonDays: HORIZON_DAYS,
  };
  console.log(`Validation sur les vidéos les plus récentes (score à ${HORIZON_DAYS} j) :`, metrics);
  if (!(metrics.brierP2x < metrics.baseBrierP2x)) {
    throw new Error(`Le modèle ne fait pas mieux que la moyenne (Brier ${metrics.brierP2x} ≥ ${metrics.baseBrierP2x}) : non enregistré.`);
  }

  const final = fitRidge(rows.map((r) => r.x), rows.map((r) => r.y));
  const model: TrainedModel = { version: MODEL_VERSION as 2, trainedAt: new Date().toISOString(), ...final, residuals: testResiduals, metrics };
  const { error } = await db.from('settings').upsert({ key: MODEL_KEY, value: model });
  if (error) throw new Error(`settings : ${error.message}`);
  console.log(`Modèle enregistré (${MODEL_KEY}) : ${model.n} vidéos, ${model.features.length} paramètres.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
