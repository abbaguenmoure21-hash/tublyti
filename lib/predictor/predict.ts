import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FEATURES,
  MODEL_KEY,
  MODEL_VERSION,
  drivers,
  predictRaw,
  probAbove,
  vectorize,
  type FeatureContext,
  type TrainedModel,
} from './model';
import {
  HORIZON_DAYS,
  channelContextAt,
  topicScoreBefore,
  viewsAt,
  weeklyToSnaps,
  type ChannelVideo,
  type Snap,
} from './context';

let cache: { at: number; model: TrainedModel | null } | null = null;

/** Modèle entraîné (gardé 10 min en mémoire). null tant que l'entraînement v2 n'a pas tourné. */
export async function loadModel(db: SupabaseClient): Promise<TrainedModel | null> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.model;
  const { data } = await db.from('settings').select('value').eq('key', MODEL_KEY).maybeSingle();
  const m = (data?.value as TrainedModel | undefined) ?? null;
  // Features must match the current vector exactly (same names, same order).
  const ok =
    m &&
    m.version === MODEL_VERSION &&
    Array.isArray(m.weights) &&
    Array.isArray(m.features) &&
    m.features.join(',') === FEATURES.join(',');
  cache = { at: Date.now(), model: ok ? m : null };
  return cache.model;
}

const DAY = 86_400_000;

/**
 * 7-day views of a channel's recent long videos. Only the snapshots around day 7
 * are read (no full history), with the weekly aggregate as a fallback once the
 * daily snapshots have been purged.
 */
export async function loadChannelHistory(db: SupabaseClient, ytChannelId: string, limit = 40): Promise<ChannelVideo[]> {
  const { data: vids, error } = await db
    .from('videos')
    .select('id, published_at, duration_s')
    .eq('channel_id', ytChannelId)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Lecture des vidéos de la chaîne impossible : ${error.message}`);
  const list = ((vids ?? []) as { id: string; published_at: string; duration_s: number | null }[]).filter(
    (v) => (v.duration_s ?? 0) > 60,
  );
  const out: ChannelVideo[] = [];
  for (let i = 0; i < list.length; i += 10) {
    const chunk = list.slice(i, i + 10);
    const done = await Promise.all(
      chunk.map(async (v) => {
        const pub = new Date(v.published_at).getTime();
        const from = new Date(pub + (HORIZON_DAYS - 2) * DAY).toISOString();
        const to = new Date(pub + (HORIZON_DAYS + 2) * DAY).toISOString();
        const { data: snaps } = await db
          .from('video_snapshots')
          .select('captured_at, views')
          .eq('video_id', v.id)
          .gte('captured_at', from)
          .lte('captured_at', to);
        let points: Snap[] = ((snaps ?? []) as { captured_at: string; views: number }[]).map((r) => ({
          at: new Date(r.captured_at).getTime(),
          views: Number(r.views) || 0,
        }));
        if (!points.length) {
          const { data: weekly } = await db
            .from('video_stats_weekly')
            .select('week_start, views')
            .eq('video_id', v.id)
            .gte('week_start', new Date(pub - 7 * DAY).toISOString().slice(0, 10))
            .lte('week_start', new Date(pub + (HORIZON_DAYS + 2) * DAY).toISOString().slice(0, 10));
          points = weeklyToSnaps((weekly ?? []) as { week_start: string; views: number }[]);
        }
        return { id: v.id, publishedMs: pub, views7d: viewsAt(points, pub, HORIZON_DAYS) };
      }),
    );
    out.push(...done);
  }
  return out;
}

/**
 * Contexte d'une vidéo pas encore publiée, construit avec les mêmes règles que l'entraînement
 * (lib/predictor/context.ts) : vues habituelles à 7 jours, élan, régularité, et le sujet le plus
 * probable (déduit des vidéos aux titres les plus proches) tel que noté avant la publication.
 */
export async function plannedContext(
  db: SupabaseClient,
  opts: {
    ytChannelId: string | null;
    title: string;
    durationS: number | null;
    publishAt: Date;
    neighborIds: string[];
    fallbackBaseline: number | null;
  },
): Promise<FeatureContext> {
  let baselineViews: number | null = null;
  let momentum: number | null = null;
  let daysSincePrev: number | null = null;

  if (opts.ytChannelId) {
    const history = await loadChannelHistory(db, opts.ytChannelId);
    const ctx = channelContextAt(history, opts.publishAt.getTime());
    baselineViews = ctx.baselineViews;
    momentum = ctx.momentum;
    daysSincePrev = ctx.daysSincePrev;
  }
  // Fallback only when the channel has no measured 7-day history (new channel).
  if (baselineViews === null) baselineViews = opts.fallbackBaseline;

  // Sujet probable : celui qui revient le plus parmi les vidéos aux titres les plus proches.
  let topicPhase: number | null = null;
  let topicMgi: number | null = null;
  let topicRecent7d = 0;
  if (opts.neighborIds.length) {
    const { data: nv } = await db.from('videos').select('topic_id').in('id', opts.neighborIds);
    const counts = new Map<string, number>();
    for (const r of (nv ?? []) as { topic_id: string | null }[])
      if (r.topic_id) counts.set(r.topic_id, (counts.get(r.topic_id) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      const pubDay = opts.publishAt.toISOString().slice(0, 10);
      const since = new Date(opts.publishAt.getTime() - 7 * DAY).toISOString();
      const [{ data: s }, { count }] = await Promise.all([
        db
          .from('topic_scores')
          .select('scored_at, mgi, phase')
          .eq('topic_id', top[0])
          .lt('scored_at', pubDay)
          .order('scored_at', { ascending: false })
          .limit(1),
        db
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .eq('topic_id', top[0])
          .gte('published_at', since)
          .lt('published_at', opts.publishAt.toISOString()),
      ]);
      const ts = topicScoreBefore(
        (s ?? []) as { scored_at: string; mgi: number | null; phase: number | null }[],
        opts.publishAt.getTime(),
      );
      topicPhase = ts?.phase ?? null;
      topicMgi = ts?.mgi ?? null;
      topicRecent7d = count ?? 0;
    }
  }

  return {
    durationS: opts.durationS,
    publishedAt: opts.publishAt,
    baselineViews,
    momentum,
    daysSincePrev,
    title: opts.title,
    topicPhase,
    topicMgi,
    topicRecent7d,
  };
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
