/**
 * Entraîne le modèle de prédiction des vues sur toutes les vidéos suivies par TubLyTI.
 *
 *   npx tsx scripts/train-predictor.ts            (en local, lit .env.local)
 *   GitHub → Actions → « Train predictor » (chaque dimanche, ou à la main)
 *
 * Cible : log(score de sur-performance) = log(vues ÷ vues habituelles de la chaîne au même âge),
 * pour les vidéos d'au moins 7 jours. Validation sur les 15 % de vidéos les plus récentes
 * (on prédit le futur à partir du passé), puis entraînement final sur tout.
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

import { MODEL_KEY, fitRidge, predictRaw, probAbove, vectorize, type FeatureContext, type TrainedModel } from '../lib/predictor/model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function all<T>(db: SupabaseClient, table: string, cols: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 500_000; from += 1000) {
    let q = db.from(table).select(cols).order(cols.split(',')[0].trim()).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} : ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const clampLog = (s: number) => Math.log(Math.min(100, Math.max(0.05, s)));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes');
  const db = createClient(url, key);

  console.log('Chargement des données…');
  const [outliers, videos, channels, topics, scores] = await Promise.all([
    all<{ video_id: string; score: number; baseline: number; age_days: number }>(db, 'video_outliers', 'video_id, score, baseline, age_days'),
    all<{ id: string; channel_id: string; topic_id: string | null; title: string | null; published_at: string | null; duration_s: number | null }>(db, 'videos', 'id, channel_id, topic_id, title, published_at, duration_s'),
    all<{ id: string; subscriber_count: number | null }>(db, 'channels', 'id, subscriber_count'),
    all<{ id: string; phase: number | null }>(db, 'topics', 'id, phase'),
    all<{ topic_id: string; scored_at: string; mgi: number | null }>(db, 'topic_scores', 'topic_id, scored_at, mgi', (q) =>
      q.gte('scored_at', new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10)),
    ),
  ]);
  console.log(`  ${outliers.length} scores, ${videos.length} vidéos, ${channels.length} chaînes, ${topics.length} sujets`);

  const score = new Map(outliers.map((o) => [o.video_id, o]));
  const subs = new Map(channels.map((c) => [c.id, c.subscriber_count]));
  const phase = new Map(topics.map((t) => [t.id, t.phase]));
  const mgi = new Map<string, { at: string; v: number | null }>();
  for (const s of scores) if (!mgi.has(s.topic_id) || mgi.get(s.topic_id)!.at < s.scored_at) mgi.set(s.topic_id, { at: s.scored_at, v: s.mgi });

  // Par chaîne : vidéos dans l'ordre de publication (élan + écart avec la précédente).
  const vids = videos.filter((v) => v.published_at && v.title);
  const byChannel = new Map<string, typeof vids>();
  for (const v of vids) byChannel.set(v.channel_id, [...(byChannel.get(v.channel_id) ?? []), v]);
  // Par sujet : dates de publication (concurrence des 7 jours précédents).
  const byTopic = new Map<string, number[]>();
  for (const v of vids) if (v.topic_id) byTopic.set(v.topic_id, [...(byTopic.get(v.topic_id) ?? []), new Date(v.published_at!).getTime()]);
  for (const arr of byTopic.values()) arr.sort((a, b) => a - b);

  const rows: { t: number; x: number[]; y: number }[] = [];
  for (const list of byChannel.values()) {
    list.sort((a, b) => a.published_at!.localeCompare(b.published_at!));
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const o = score.get(v.id);
      if (!o || o.age_days < 7 || !(o.baseline > 0)) continue;
      const t = new Date(v.published_at!).getTime();
      const prev = list.slice(Math.max(0, i - 5), i).map((p) => score.get(p.id)).filter(Boolean) as typeof outliers;
      const topicTimes = v.topic_id ? byTopic.get(v.topic_id) ?? [] : [];
      const ctx: FeatureContext = {
        durationS: v.duration_s,
        publishedAt: new Date(t),
        subscribers: subs.get(v.channel_id) ?? null,
        baselineViews: o.baseline,
        momentum: prev.length >= 2 ? prev.reduce((s, p) => s + clampLog(Number(p.score)), 0) / prev.length : null,
        daysSincePrev: i > 0 ? (t - new Date(list[i - 1].published_at!).getTime()) / 86_400_000 : null,
        title: v.title!,
        topicPhase: v.topic_id ? phase.get(v.topic_id) ?? null : null,
        topicMgi: v.topic_id ? mgi.get(v.topic_id)?.v ?? null : null,
        topicRecent7d: topicTimes.filter((x) => x < t && x >= t - 7 * 86_400_000).length,
      };
      rows.push({ t, x: vectorize(ctx), y: clampLog(Number(o.score)) });
    }
  }
  if (rows.length < 300) throw new Error(`Pas assez de vidéos mesurées (${rows.length}) pour entraîner le modèle.`);
  rows.sort((a, b) => a.t - b.t);

  // Validation : on apprend sur le passé, on teste sur les 15 % les plus récents.
  const cut = Math.floor(rows.length * 0.85);
  const train = rows.slice(0, cut);
  const test = rows.slice(cut);
  const m0 = fitRidge(train.map((r) => r.x), train.map((r) => r.y));
  const yBar = train.reduce((s, r) => s + r.y, 0) / train.length;
  let sse = 0, sst = 0, mae = 0, brier = 0, baseBrier = 0;
  const baseP2x = train.filter((r) => r.y >= Math.log(2)).length / train.length;
  for (const r of test) {
    const p = predictRaw(m0, r.x);
    sse += (r.y - p) ** 2;
    sst += (r.y - yBar) ** 2;
    mae += Math.abs(r.y - p);
    const hit = r.y >= Math.log(2) ? 1 : 0;
    brier += (probAbove(m0, p, Math.log(2)) - hit) ** 2;
    baseBrier += (baseP2x - hit) ** 2;
  }
  const metrics = {
    testN: test.length,
    r2: Math.round((1 - sse / sst) * 1000) / 1000,
    maeLog: Math.round((mae / test.length) * 1000) / 1000,
    brierP2x: Math.round((brier / test.length) * 1000) / 1000,
    baseBrierP2x: Math.round((baseBrier / test.length) * 1000) / 1000,
    baseP2x: Math.round(baseP2x * 1000) / 1000,
  };
  console.log('Validation sur les vidéos les plus récentes :', metrics);

  const final = fitRidge(rows.map((r) => r.x), rows.map((r) => r.y));
  const model: TrainedModel = { version: 1, trainedAt: new Date().toISOString(), ...final, metrics };
  const { error } = await db.from('settings').upsert({ key: MODEL_KEY, value: model });
  if (error) throw new Error(`settings : ${error.message}`);
  console.log(`Modèle enregistré : ${model.n} vidéos, ${model.features.length} paramètres.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
