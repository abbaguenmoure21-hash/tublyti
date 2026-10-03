import type { SupabaseClient } from '@supabase/supabase-js';

export interface DigestNicheBlock {
  nicheName: string;
  ownerChannel: string;
  topTopics: { label: string; mgi: number; phase: number }[];
  newPhase2: { label: string; mgi: number }[];
  publishedVideos: {
    label: string;
    angleTitle: string;
    videoId: string;
    daysSincePublish: number;
    views: number | null;
  }[];
}

export interface DigestAlertEvent {
  ruleLabel: string;
  ruleType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface DigestData {
  generatedAt: string;
  blocks: DigestNicheBlock[];
  alertEvents: DigestAlertEvent[];
}

export interface DigestScope {
  /** Compte destinataire : ses vidéos publiées et ses alertes. */
  userId?: string;
  /** Thématiques du compte (null = toutes, pour l'administrateur). */
  nicheIds?: string[] | null;
  /** Nom de chaîne à afficher par thématique. */
  labels?: Map<string, string>;
  /** La table alert_events a-t-elle la colonne user_id (migration 00019) ? */
  personalAlerts?: boolean;
  /** Inclure les alertes (faux pour un client tant que les alertes ne sont pas personnelles). */
  includeAlerts?: boolean;
}

export async function buildDigestData(db: SupabaseClient, scope: DigestScope = {}): Promise<DigestData> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get all active niches
  let nichesQ = db.from('niches').select('id, name, owner_channel').eq('status', 'active');
  if (scope.nicheIds) nichesQ = nichesQ.in('id', scope.nicheIds.length ? scope.nicheIds : ['00000000-0000-0000-0000-000000000000']);
  const { data: niches } = await nichesQ.order('name');

  if (!niches?.length) return { generatedAt: now.toISOString(), blocks: [], alertEvents: [] };

  const blocks: DigestNicheBlock[] = [];

  for (const niche of niches) {
    // 1. Top 5 topics by MGI for this niche
    const { data: topTopicsRaw } = await db
      .from('topics')
      .select('id, label, phase')
      .eq('niche_id', niche.id)
      .in('status', ['active', 'in_production'])
      .limit(50);

    const topicIds = (topTopicsRaw ?? []).map((t: Record<string, unknown>) => t.id as string);

    let topTopics: { label: string; mgi: number; phase: number }[] = [];
    if (topicIds.length > 0) {
      const { data: scores } = await db
        .from('topic_scores')
        .select('topic_id, mgi, phase')
        .in('topic_id', topicIds)
        .order('scored_at', { ascending: false });

      // Get latest score per topic
      const latest: Record<string, { mgi: number; phase: number }> = {};
      const seen = new Set<string>();
      for (const s of scores ?? []) {
        if (!seen.has(s.topic_id)) {
          seen.add(s.topic_id);
          latest[s.topic_id] = { mgi: Number(s.mgi), phase: Number(s.phase) };
        }
      }

      const topicsMap = new Map(
        (topTopicsRaw ?? []).map((t: Record<string, unknown>) => [t.id as string, t.label as string]),
      );

      topTopics = Object.entries(latest)
        .map(([id, s]) => ({ label: topicsMap.get(id) ?? '', mgi: s.mgi, phase: s.phase }))
        .sort((a, b) => b.mgi - a.mgi)
        .slice(0, 5);
    }

    // 2. Topics that moved to phase 2 this week
    const { data: phase2Scores } = await db
      .from('topic_scores')
      .select('topic_id, mgi')
      .eq('phase', 2)
      .gte('scored_at', oneWeekAgo.toISOString().slice(0, 10))
      .in('topic_id', topicIds.length > 0 ? topicIds : ['00000000-0000-0000-0000-000000000000']);

    // Deduplicate
    const phase2Seen = new Set<string>();
    const newPhase2: { label: string; mgi: number }[] = [];
    for (const s of phase2Scores ?? []) {
      if (phase2Seen.has(s.topic_id)) continue;
      phase2Seen.add(s.topic_id);
      const topic = (topTopicsRaw ?? []).find((t: Record<string, unknown>) => t.id === s.topic_id);
      if (topic) {
        newPhase2.push({ label: topic.label as string, mgi: Number(s.mgi) });
      }
    }

    // 3. Published videos (angles with status=published and a video_id)
    let publishedQ = db
      .from('angles')
      .select('id, title, video_id, topic_id, topics(label)')
      .eq('status', 'published')
      .not('video_id', 'is', null)
      .in('topic_id', topicIds.length > 0 ? topicIds : ['00000000-0000-0000-0000-000000000000']);
    if (scope.userId) publishedQ = publishedQ.eq('user_id', scope.userId);
    const { data: publishedAngles } = await publishedQ;

    const publishedVideos: DigestNicheBlock['publishedVideos'] = [];
    for (const a of publishedAngles ?? []) {
      if (!a.video_id) continue;

      // Get video publish date from videos table
      const { data: video } = await db
        .from('videos')
        .select('published_at')
        .eq('id', a.video_id)
        .single();

      const pubDate = video?.published_at ? new Date(video.published_at) : null;
      const daysSincePublish = pubDate
        ? Math.floor((now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Only include videos around J+30 (published 25-35 days ago) or recent
      if (pubDate && pubDate < thirtyDaysAgo) continue;

      // Get latest snapshot for views
      const { data: snapshot } = await db
        .from('video_snapshots')
        .select('views')
        .eq('video_id', a.video_id)
        .order('captured_at', { ascending: false })
        .limit(1)
        .single();

      publishedVideos.push({
        label: (a.topics as unknown as { label: string } | null)?.label ?? '',
        angleTitle: a.title ?? '',
        videoId: a.video_id,
        daysSincePublish,
        views: snapshot?.views ? Number(snapshot.views) : null,
      });
    }

    // Only add block if there's content
    if (topTopics.length > 0 || newPhase2.length > 0 || publishedVideos.length > 0) {
      blocks.push({
        nicheName: niche.name,
        ownerChannel: scope.labels?.get(niche.id as string) ?? (niche.owner_channel as string) ?? '',
        topTopics,
        newPhase2,
        publishedVideos,
      });
    }
  }

  // ── Alert events not yet emailed ────────────────────────────────
  let alertsQ = db
    .from('alert_events')
    .select('id, rule_type, payload, created_at, alert_rules!inner(label)')
    .eq('emailed', false);
  if (scope.userId && scope.personalAlerts) alertsQ = alertsQ.eq('user_id', scope.userId);
  const { data: pendingAlerts } =
    scope.includeAlerts === false ? { data: [] as never[] } : await alertsQ.order('created_at', { ascending: false }).limit(50);

  const alertEvents: DigestAlertEvent[] = (pendingAlerts ?? []).map((e) => ({
    ruleLabel: (e.alert_rules as unknown as { label: string }).label,
    ruleType: e.rule_type,
    payload: e.payload as Record<string, unknown>,
    createdAt: e.created_at,
  }));

  // Mark them as emailed
  const alertEventIds = (pendingAlerts ?? []).map((e) => e.id);
  if (alertEventIds.length > 0) {
    await db
      .from('alert_events')
      .update({ emailed: true })
      .in('id', alertEventIds);
  }

  return { generatedAt: now.toISOString(), blocks, alertEvents };
}
