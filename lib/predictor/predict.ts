import type { SupabaseClient } from '@supabase/supabase-js';
import { MODEL_KEY, drivers, predictRaw, probAbove, vectorize, type FeatureContext, type TrainedModel } from './model';

let cache: { at: number; model: TrainedModel | null } | null = null;

/** Modèle entraîné (gardé 10 min en mémoire). null tant que l'entraînement n'a pas tourné. */
export async function loadModel(db: SupabaseClient): Promise<TrainedModel | null> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.model;
  const { data } = await db.from('settings').select('value').eq('key', MODEL_KEY).maybeSingle();
  const m = (data?.value as TrainedModel | undefined) ?? null;
  cache = { at: Date.now(), model: m && Array.isArray(m.weights) ? m : null };
  return cache.model;
}

const clampLog = (s: number) => Math.log(Math.min(100, Math.max(0.05, s)));

/**
 * Contexte d'une vidéo pas encore publiée : la chaîne (abonnés, vues habituelles, élan, régularité)
 * et le sujet le plus probable (déduit des vidéos aux titres les plus proches).
 */
export async function plannedContext(
  db: SupabaseClient,
  opts: { ytChannelId: string | null; title: string; durationS: number | null; publishAt: Date; neighborIds: string[]; fallbackBaseline: number | null },
): Promise<FeatureContext> {
  let subscribers: number | null = null;
  let baselineViews: number | null = opts.fallbackBaseline;
  let momentum: number | null = null;
  let daysSincePrev: number | null = null;

  if (opts.ytChannelId) {
    const [{ data: ch }, { data: last }] = await Promise.all([
      db.from('channels').select('subscriber_count').eq('id', opts.ytChannelId).maybeSingle(),
      db.from('videos').select('id, published_at').eq('channel_id', opts.ytChannelId).not('published_at', 'is', null).order('published_at', { ascending: false }).limit(8),
    ]);
    subscribers = (ch?.subscriber_count as number | null) ?? null;
    const recent = (last ?? []) as { id: string; published_at: string }[];
    if (recent[0]) daysSincePrev = (opts.publishAt.getTime() - new Date(recent[0].published_at).getTime()) / 86_400_000;
    if (recent.length) {
      const { data: o } = await db.from('video_outliers').select('video_id, score, baseline').in('video_id', recent.map((r) => r.id));
      const rows = (o ?? []) as { video_id: string; score: number; baseline: number }[];
      const order = new Map(recent.map((r, i) => [r.id, i]));
      rows.sort((a, b) => (order.get(a.video_id) ?? 0) - (order.get(b.video_id) ?? 0));
      const five = rows.slice(0, 5);
      if (five.length >= 2) momentum = five.reduce((s, r) => s + clampLog(Number(r.score)), 0) / five.length;
      if (rows[0]?.baseline) baselineViews = Number(rows[0].baseline);
    }
  }

  // Sujet probable : celui qui revient le plus parmi les vidéos aux titres les plus proches.
  let topicPhase: number | null = null;
  let topicMgi: number | null = null;
  let topicRecent7d = 0;
  if (opts.neighborIds.length) {
    const { data: nv } = await db.from('videos').select('topic_id').in('id', opts.neighborIds);
    const counts = new Map<string, number>();
    for (const r of (nv ?? []) as { topic_id: string | null }[]) if (r.topic_id) counts.set(r.topic_id, (counts.get(r.topic_id) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      const since = new Date(opts.publishAt.getTime() - 7 * 86_400_000).toISOString();
      const [{ data: t }, { data: s }, { count }] = await Promise.all([
        db.from('topics').select('phase').eq('id', top[0]).maybeSingle(),
        db.from('topic_scores').select('mgi').eq('topic_id', top[0]).order('scored_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('videos').select('id', { count: 'exact', head: true }).eq('topic_id', top[0]).gte('published_at', since),
      ]);
      topicPhase = (t?.phase as number | null) ?? null;
      topicMgi = s?.mgi == null ? null : Number(s.mgi);
      topicRecent7d = count ?? 0;
    }
  }

  return { durationS: opts.durationS, publishedAt: opts.publishAt, subscribers, baselineViews, momentum, daysSincePrev, title: opts.title, topicPhase, topicMgi, topicRecent7d };
}

export interface ModelPrediction {
  logPred: number;
  drivers: { label: string; effect: number }[];
  metrics: TrainedModel['metrics'];
  trainedAt: string;
  n: number;
}

export function predictWithModel(model: TrainedModel, ctx: FeatureContext): ModelPrediction {
  const x = vectorize(ctx);
  return { logPred: predictRaw(model, x), drivers: drivers(model, x).slice(0, 6), metrics: model.metrics, trainedAt: model.trainedAt, n: model.n };
}

export { probAbove };
