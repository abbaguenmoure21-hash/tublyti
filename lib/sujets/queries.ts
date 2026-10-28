import type { SupabaseClient } from '@supabase/supabase-js';
import { getLatestScoreDate } from '@/lib/scoring/latest-score-date';
import { isSensitiveTopic } from '@/lib/topics/sensitive';
import { isDbReady } from '@/lib/auth/session';

export type Reliability = 'high' | 'medium' | 'low';

export interface TopicRow {
  id: string;
  label: string;
  nicheId: string;
  phase: number;
  potential: number;
  reliability: Reliability;
  status: string;
  /** Le client a déjà créé une vidéo sur ce sujet. */
  inMyVideos: boolean;
  sensitive: boolean;
  /** Subscriber counts of channels already on the topic (per-user feasibility). */
  competitorSubs: number[] | null;
}

export interface TopicFilters {
  userId: string;
  nicheIds: string[];
  moments: number[];
  reliableOnly: boolean;
  query: string;
}

export const DEFAULT_MOMENTS = [2, 1, 0];

export function parseMoments(raw: string | undefined): number[] {
  if (raw === 'tous') return [0, 1, 2, 3];
  if (!raw) return DEFAULT_MOMENTS;
  const list = raw
    .split(',')
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x >= 0 && x <= 3);
  return list.length ? list : DEFAULT_MOMENTS;
}

/** Sujets ignorés par le client et sujets sur lesquels il a déjà une vidéo. */
export async function getUserTopicSets(db: SupabaseClient, userId: string) {
  const [ignoredRes, mineRes] = await Promise.all([
    db.from('user_topic_state').select('topic_id').eq('user_id', userId).eq('state', 'ignored'),
    db.from('angles').select('topic_id').eq('user_id', userId),
  ]);
  return {
    ignored: new Set((ignoredRes.data ?? []).map((r) => r.topic_id as string)),
    mine: new Set((mineRes.data ?? []).map((r) => r.topic_id as string)),
  };
}

/**
 * Latest scoring date, or null when nothing has been scored yet (first night not run).
 * (getLatestScoreDate falls back to today, which made the UI claim « mis à jour aujourd'hui ».)
 */
export async function getLatestScoreDateOrNull(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db.from('topic_scores').select('scored_at').order('scored_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`latest score date failed: ${error.message}`);
  return (data?.scored_at as string | undefined) ?? null;
}

/** Liste des sujets scorés, filtrée et triée (potentiel décroissant, sujets sensibles en fin de liste). */
export async function listTopics(db: SupabaseClient, f: TopicFilters): Promise<{ rows: TopicRow[]; scoredAt: string | null }> {
  const scoredAt = await getLatestScoreDateOrNull(db);
  if (!f.nicheIds.length || !scoredAt) return { rows: [], scoredAt };
  const [{ ignored, mine }, ready] = await Promise.all([getUserTopicSets(db, f.userId), isDbReady()]);
  let q = db
    .from('topic_scores')
    .select('mgi, phase, confidence, competitor_subs, topics!inner(id, label, status, niche_id)')
    .eq('scored_at', scoredAt)
    .in('topics.status', ['active', 'in_production'])
    .not('mgi', 'is', null)
    .in('phase', f.moments)
    .order('mgi', { ascending: false })
    .limit(300);
  q = q.in('topics.niche_id', f.nicheIds);
  if (f.reliableOnly) q = q.in('confidence', ['high', 'medium']);
  if (f.query) q = q.ilike('topics.label', `%${f.query.replace(/[%_]/g, '')}%`);

  const { data, error } = await q;
  // A failing query must reach the error state, not look like « no topic matches these filters ».
  if (error) throw new Error(`listTopics failed: ${error.message}`);
  const rows: TopicRow[] = (data ?? [])
    .filter((s) => !ignored.has((s.topics as unknown as { id: string }).id))
    .map((s) => {
    const t = s.topics as unknown as { id: string; label: string; status: string; niche_id: string };
    const conf = (s.confidence as string | null) ?? 'low';
    return {
      id: t.id,
      label: t.label,
      nicheId: t.niche_id,
      phase: Number(s.phase ?? 0),
      potential: Math.round(Number(s.mgi)),
      reliability: (['high', 'medium', 'low'].includes(conf) ? conf : 'low') as Reliability,
      status: t.status,
      // Per account once multi-account is on; the shared topics.status only before migration 00018.
      inMyVideos: ready ? mine.has(t.id) : t.status === 'in_production',
      sensitive: isSensitiveTopic(t.label),
      competitorSubs: (s.competitor_subs as number[] | null) ?? null,
    };
  });
  rows.sort((a, b) => Number(a.sensitive) - Number(b.sensitive) || b.potential - a.potential);
  return { rows, scoredAt };
}

export interface TopicDetail {
  id: string;
  label: string;
  nicheId: string;
  nicheName: string;
  status: string;
  inMyVideos: boolean;
  ignored: boolean;
  phase: number | null;
  potential: number | null;
  reliability: Reliability | null;
  videoCount90d: number;
  channelCount: number;
  quotes: { text: string; likes: number }[];
  angles: { id: string; title: string; hook: string | null }[];
  sensitive: boolean;
  competitorSubs: number[] | null;
}

/** Détail d'un sujet pour le panneau latéral. */
export async function getTopicDetail(db: SupabaseClient, topicId: string, userId: string): Promise<TopicDetail | null> {
  const scoredAt = await getLatestScoreDate(db);
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const ready = await isDbReady();
  let proposedAngles = db.from('angles').select('id, title, hook').eq('topic_id', topicId).eq('status', 'idea');
  if (ready) proposedAngles = proposedAngles.is('user_id', null);
  const [topicRes, scoreRes, videosRes, anglesRes, mineRes, stateRes] = await Promise.all([
    db.from('topics').select('id, label, status, niche_id, niches(name)').eq('id', topicId).single(),
    db.from('topic_scores').select('mgi, phase, confidence, competitor_subs').eq('topic_id', topicId).eq('scored_at', scoredAt).maybeSingle(),
    db.from('videos').select('id, channel_id, published_at').eq('topic_id', topicId).limit(1000),
    // Angles proposés par TubLyTI (communs à tous) : ceux qui n'appartiennent à personne.
    proposedAngles.order('created_at', { ascending: false }).limit(5),
    db.from('angles').select('id', { count: 'exact', head: true }).eq('topic_id', topicId).eq('user_id', userId),
    db.from('user_topic_state').select('state').eq('topic_id', topicId).eq('user_id', userId).maybeSingle(),
  ]);
  // Not found (PGRST116) → null; any other failure → error state.
  if (topicRes.error && topicRes.error.code !== 'PGRST116') throw new Error(`getTopicDetail failed: ${topicRes.error.message}`);
  if (topicRes.error || !topicRes.data) return null;
  if (scoreRes.error) throw new Error(`getTopicDetail score failed: ${scoreRes.error.message}`);
  const topic = topicRes.data as unknown as {
    id: string; label: string; status: string; niche_id: string;
    niches: { name: string } | null;
  };

  const videos = (videosRes.data ?? []) as { id: string; channel_id: string; published_at: string | null }[];
  const recent = videos.filter((v) => v.published_at && v.published_at >= since);
  const channelCount = new Set(recent.map((v) => v.channel_id)).size;

  // Les 3 commentaires « frustrés » les plus likés.
  let quotes: { text: string; likes: number }[] = [];
  const videoIds = videos.map((v) => v.id).slice(0, 200);
  if (videoIds.length) {
    const { data: comments } = await db
      .from('comments')
      .select('id, text, like_count')
      .in('video_id', videoIds)
      .order('like_count', { ascending: false })
      .limit(150);
    const ids = (comments ?? []).map((c) => c.id as string);
    if (ids.length) {
      const { data: labels } = await db.from('comment_labels').select('comment_id').in('comment_id', ids).neq('label', 'none');
      const frustrated = new Set((labels ?? []).map((l) => l.comment_id as string));
      quotes = (comments ?? [])
        .filter((c) => frustrated.has(c.id as string))
        .slice(0, 3)
        .map((c) => ({ text: String(c.text).replace(/\s+/g, ' ').trim().slice(0, 220), likes: Number(c.like_count ?? 0) }));
    }
  }

  const s = scoreRes.data as { mgi: number | null; phase: number | null; confidence: string | null; competitor_subs: number[] | null } | null;
  const conf = s?.confidence ?? null;
  return {
    id: topic.id,
    label: topic.label,
    nicheId: topic.niche_id,
    nicheName: topic.niches?.name ?? '',
    status: topic.status,
    inMyVideos: ready ? (mineRes.count ?? 0) > 0 : topic.status === 'in_production',
    ignored: stateRes.data?.state === 'ignored',
    phase: s?.phase ?? null,
    potential: s?.mgi != null ? Math.round(Number(s.mgi)) : null,
    reliability: conf && ['high', 'medium', 'low'].includes(conf) ? (conf as Reliability) : null,
    videoCount90d: recent.length,
    channelCount,
    quotes,
    angles: (anglesRes.data ?? []).map((a) => ({ id: a.id as string, title: String(a.title ?? ''), hook: (a.hook as string | null) ?? null })),
    sensitive: isSensitiveTopic(topic.label),
    competitorSubs: s?.competitor_subs ?? null,
  };
}
