import { SupabaseClient } from '@supabase/supabase-js';
import {
  computeMGI,
  computeDemand,
  computeFrustration,
  computeSupplyQualified,
  computeConfidence,
  DEFAULT_MGI_WEIGHTS,
  type MGIWeights,
  type TopicSignals,
} from './mgi';
import { computePhase } from './phase';
import { computeFeasibility } from './feasibility';
import type { AlertSender } from '../email/alerts';
import { evaluateAlertRules } from '../alerts/evaluate';

// ── Types ────────────────────────────────────────────────────────────

export interface ScoreResult {
  topicsScored: number;
  burnDownAlerts: number;
  silentCollectionAlert: boolean;
  alertEventsCreated: number;
  alertInstantEmails: number;
}

interface ActiveTopic {
  id: string;
  label: string;
  niche_id: string;
  status: string;
  rpm_coefficient: number;
  owner_channel: string | null;
}

// ── Settings defaults ────────────────────────────────────────────────

async function getWeights(db: SupabaseClient): Promise<MGIWeights> {
  const { data } = await db
    .from('settings')
    .select('value')
    .eq('key', 'mgi_weights')
    .single();

  if (data?.value && typeof data.value === 'object') {
    const v = data.value as Record<string, number>;
    return {
      trends: v.trends ?? DEFAULT_MGI_WEIGHTS.trends,
      ytViews: v.ytViews ?? DEFAULT_MGI_WEIGHTS.ytViews,
      social: v.social ?? DEFAULT_MGI_WEIGHTS.social,
    };
  }

  // Create default
  await db.from('settings').upsert({
    key: 'mgi_weights',
    value: DEFAULT_MGI_WEIGHTS,
  });
  return DEFAULT_MGI_WEIGHTS;
}

// ── Main service ─────────────────────────────────────────────────────

export async function runScore(
  db: SupabaseClient,
  alertSender: AlertSender,
): Promise<ScoreResult> {
  const result: ScoreResult = { topicsScored: 0, burnDownAlerts: 0, silentCollectionAlert: false, alertEventsCreated: 0, alertInstantEmails: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const weights = await getWeights(db);

  // ── Load active topics with niche info ──────────────────────────
  const { data: topicsRaw } = await db
    .from('topics')
    .select('id, label, niche_id, status, niches!inner(rpm_coefficient, owner_channel)')
    .in('status', ['active', 'in_production']);

  if (!topicsRaw || topicsRaw.length === 0) return result;

  const topics: ActiveTopic[] = topicsRaw.map((t) => {
    const niche = t.niches as unknown as { rpm_coefficient: number; owner_channel: string | null };
    return {
      id: t.id,
      label: t.label,
      niche_id: t.niche_id,
      status: t.status,
      rpm_coefficient: niche.rpm_coefficient ?? 1.0,
      owner_channel: niche.owner_channel ?? null,
    };
  });

  const topicIds = topics.map((t) => t.id);

  // ── Gather signals for all topics ───────────────────────────────
  // Most recent trend_point per topic+source
  const { data: trendPoints } = await db
    .from('trend_points')
    .select('topic_id, source, value')
    .in('topic_id', topicIds)
    .gte('captured_at', new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10))
    .order('captured_at', { ascending: false });

  // Build latest value per topic+source (first occurrence = latest due to desc order)
  const latestSignal = new Map<string, number>();
  for (const p of trendPoints ?? []) {
    const key = `${p.topic_id}:${p.source}`;
    if (!latestSignal.has(key)) {
      latestSignal.set(key, Number(p.value));
    }
  }

  // For trend growth (90 days), get oldest and newest per topic
  const trendGrowth = new Map<string, number>();
  const oldestSignal = new Map<string, number>();
  for (const p of trendPoints ?? []) {
    if (p.source !== 'trends') continue;
    const key = p.topic_id;
    oldestSignal.set(key, Number(p.value)); // last in desc = oldest
  }
  for (const topicId of topicIds) {
    const newest = latestSignal.get(`${topicId}:trends`);
    const oldest = oldestSignal.get(topicId);
    if (newest !== undefined && oldest !== undefined && oldest > 0) {
      trendGrowth.set(topicId, (newest - oldest) / oldest);
    } else {
      trendGrowth.set(topicId, 0);
    }
  }

  // Reddit/HN rising check: compare last 7 days vs previous 7 days
  const { data: socialPoints } = await db
    .from('trend_points')
    .select('topic_id, source, captured_at, value')
    .in('topic_id', topicIds)
    .in('source', ['reddit', 'hn'])
    .gte('captured_at', new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10))
    .order('captured_at', { ascending: true });

  const socialRising = new Map<string, boolean>();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  for (const topicId of topicIds) {
    const pts = (socialPoints ?? []).filter((p) => p.topic_id === topicId);
    let recentSum = 0;
    let recentCount = 0;
    let olderSum = 0;
    let olderCount = 0;
    for (const p of pts) {
      if (p.captured_at >= sevenDaysAgo) {
        recentSum += Number(p.value);
        recentCount++;
      } else {
        olderSum += Number(p.value);
        olderCount++;
      }
    }
    const recentAvg = recentCount > 0 ? recentSum / recentCount : 0;
    const olderAvg = olderCount > 0 ? olderSum / olderCount : 0;
    socialRising.set(topicId, recentAvg > olderAvg * 1.2);
  }

  // Build TopicSignals for all topics (for percentile computation)
  const allSignals: TopicSignals[] = topics.map((t) => ({
    trends: latestSignal.get(`${t.id}:trends`) ?? null,
    ytViews: latestSignal.get(`${t.id}:yt_views`) ?? null,
    social: combineSocial(
      latestSignal.get(`${t.id}:reddit`),
      latestSignal.get(`${t.id}:hn`),
    ),
  }));

  // ── Frustration per topic ───────────────────────────────────────
  // Count of comments with frustration label (confidence >= 0.7) and total comments per topic
  const { data: topicVideoIds } = await db
    .from('videos')
    .select('id, topic_id')
    .in('topic_id', topicIds);

  // Group video IDs by topic
  const videosByTopic = new Map<string, string[]>();
  for (const v of topicVideoIds ?? []) {
    if (!v.topic_id) continue;
    if (!videosByTopic.has(v.topic_id)) videosByTopic.set(v.topic_id, []);
    videosByTopic.get(v.topic_id)!.push(v.id);
  }

  const allVideoIds = (topicVideoIds ?? []).map((v) => v.id);

  // Batch-fetch comment counts and frustration counts
  const frustrationByTopic = new Map<string, { frustration: number; total: number }>();

  if (allVideoIds.length > 0) {
    // Total comments per video
    const { data: commentCounts } = await db
      .from('comments')
      .select('video_id')
      .in('video_id', allVideoIds);

    // Frustration labels
    const { data: labeledComments } = await db
      .from('comment_labels')
      .select('comment_id, label, confidence, comments!inner(video_id)')
      .in('comments.video_id', allVideoIds)
      .neq('label', 'none')
      .gte('confidence', 0.7);

    // Count per video
    const totalPerVideo = new Map<string, number>();
    for (const c of commentCounts ?? []) {
      totalPerVideo.set(c.video_id, (totalPerVideo.get(c.video_id) ?? 0) + 1);
    }

    const frustPerVideo = new Map<string, number>();
    for (const l of labeledComments ?? []) {
      const vid = (l.comments as unknown as { video_id: string }).video_id;
      frustPerVideo.set(vid, (frustPerVideo.get(vid) ?? 0) + 1);
    }

    // Aggregate per topic
    for (const [topicId, vids] of videosByTopic) {
      let total = 0;
      let frust = 0;
      for (const vid of vids) {
        total += totalPerVideo.get(vid) ?? 0;
        frust += frustPerVideo.get(vid) ?? 0;
      }
      frustrationByTopic.set(topicId, { frustration: frust, total });
    }
  }

  // ── Supply qualified per topic ──────────────────────────────────
  const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const twoYearsAgo = new Date(Date.now() - 730 * 86_400_000).toISOString();
  const seventyTwoHoursAgo = new Date(Date.now() - 72 * 3_600_000).toISOString();

  // Qualified videos in 180 days per topic
  const { data: recentQualified } = await db
    .from('videos')
    .select('id, topic_id, published_at')
    .in('topic_id', topicIds)
    .eq('is_qualified', true)
    .gte('published_at', sixMonthsAgo);

  const qualifiedRecentByTopic = new Map<string, number>();
  const qualifiedIn72hByTopic = new Map<string, number>();
  for (const v of recentQualified ?? []) {
    if (!v.topic_id) continue;
    qualifiedRecentByTopic.set(
      v.topic_id,
      (qualifiedRecentByTopic.get(v.topic_id) ?? 0) + 1,
    );
    if (v.published_at >= seventyTwoHoursAgo) {
      qualifiedIn72hByTopic.set(
        v.topic_id,
        (qualifiedIn72hByTopic.get(v.topic_id) ?? 0) + 1,
      );
    }
  }

  // Old videos (≥2 years) with ≥10k views/month
  const { data: oldQualified } = await db
    .from('videos')
    .select('id, topic_id')
    .in('topic_id', topicIds)
    .eq('is_qualified', true)
    .lte('published_at', twoYearsAgo);

  const oldHighViewByTopic = new Map<string, number>();
  if (oldQualified && oldQualified.length > 0) {
    const oldVideoIds = oldQualified.map((v) => v.id);
    // Get latest snapshot for each old video
    const { data: oldSnaps } = await db
      .from('video_snapshots')
      .select('video_id, views')
      .in('video_id', oldVideoIds)
      .order('captured_at', { ascending: false });

    const latestViewsByVideo = new Map<string, number>();
    for (const s of oldSnaps ?? []) {
      if (!latestViewsByVideo.has(s.video_id)) {
        latestViewsByVideo.set(s.video_id, s.views ?? 0);
      }
    }

    // Map old videos to their topics
    const oldVideoTopics = new Map<string, string>();
    for (const v of oldQualified) {
      if (v.topic_id) oldVideoTopics.set(v.id, v.topic_id);
    }

    // ≥ 10k views total as proxy for ≥ 10k/month (we don't have monthly data,
    // but videos still being watched after 2+ years are likely above this)
    for (const [videoId, views] of latestViewsByVideo) {
      if (views >= 10_000) {
        const topicId = oldVideoTopics.get(videoId);
        if (topicId) {
          oldHighViewByTopic.set(
            topicId,
            (oldHighViewByTopic.get(topicId) ?? 0) + 1,
          );
        }
      }
    }
  }

  // ── Feasibility: owner channel subs + competitor subs per topic ─
  // Get unique owner channel IDs across niches
  const ownerChannelIds = [...new Set(topics.map((t) => t.owner_channel).filter(Boolean))] as string[];
  const ownerSubsByChannel = new Map<string, number>();
  if (ownerChannelIds.length > 0) {
    const { data: ownerChannels } = await db
      .from('channels')
      .select('id, subscriber_count')
      .in('id', ownerChannelIds);
    for (const ch of ownerChannels ?? []) {
      ownerSubsByChannel.set(ch.id, Number(ch.subscriber_count) || 0);
    }
  }

  // Get competitor channel subscriber counts for qualified videos per topic
  const competitorSubsByTopic = new Map<string, number[]>();
  if (recentQualified && recentQualified.length > 0) {
    const qualVideoIds = recentQualified.map((v) => v.id);
    const { data: qualVideosWithChannels } = await db
      .from('videos')
      .select('id, topic_id, channel_id, channels!inner(subscriber_count)')
      .in('id', qualVideoIds);

    for (const v of qualVideosWithChannels ?? []) {
      if (!v.topic_id) continue;
      const subs = Number((v.channels as unknown as { subscriber_count: number | null })?.subscriber_count ?? 0);
      if (!competitorSubsByTopic.has(v.topic_id)) competitorSubsByTopic.set(v.topic_id, []);
      competitorSubsByTopic.get(v.topic_id)!.push(subs);
    }
  }

  // ── Data age per topic (hours since last trend_point) ──────────
  const { data: latestCaptures } = await db
    .from('trend_points')
    .select('topic_id, captured_at')
    .in('topic_id', topicIds)
    .order('captured_at', { ascending: false });

  const dataAgeByTopic = new Map<string, number>();
  for (const p of latestCaptures ?? []) {
    if (!dataAgeByTopic.has(p.topic_id)) {
      const ageMs = Date.now() - new Date(p.captured_at).getTime();
      dataAgeByTopic.set(p.topic_id, ageMs / 3_600_000);
    }
  }

  // ── Load previous phases for alert rule evaluation ─────────────
  const previousPhaseByTopic = new Map<string, number>();
  {
    const { data: prevScores } = await db
      .from('topic_scores')
      .select('topic_id, phase')
      .in('topic_id', topicIds)
      .lt('scored_at', today)
      .order('scored_at', { ascending: false });

    for (const s of prevScores ?? []) {
      if (!previousPhaseByTopic.has(s.topic_id)) {
        previousPhaseByTopic.set(s.topic_id, s.phase as number);
      }
    }
  }

  // Collect scored topics for alert evaluation
  const scoredTopicsForAlerts: {
    id: string;
    label: string;
    niche_id: string;
    phase: number;
    previousPhase: number | null;
    qualifiedIn72h: number;
  }[] = [];

  // ── Score each topic ────────────────────────────────────────────
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const signals = allSignals[i];

    const demand = computeDemand(signals, allSignals, weights);

    const frustData = frustrationByTopic.get(topic.id) ?? { frustration: 0, total: 0 };
    const frustration = computeFrustration(frustData.frustration, frustData.total);

    const qualifiedRecent = qualifiedRecentByTopic.get(topic.id) ?? 0;
    const oldHighView = oldHighViewByTopic.get(topic.id) ?? 0;
    const supplyQualified = computeSupplyQualified(qualifiedRecent, oldHighView);

    const mgi = computeMGI({
      demand,
      frustration,
      supplyQualified,
      monetization: topic.rpm_coefficient,
    });

    const qualifiedIn72h = qualifiedIn72hByTopic.get(topic.id) ?? 0;
    const phase = computePhase({
      redditHnRising: socialRising.get(topic.id) ?? false,
      supplyQualified: qualifiedRecent,
      trendsGrowth90d: trendGrowth.get(topic.id) ?? 0,
      qualifiedIn72h,
    });

    // Compute confidence
    const demandSourceCount = [signals.trends, signals.ytViews, signals.social]
      .filter((v) => v !== null).length
      + (latestSignal.has(`${topic.id}:hn`) ? 1 : 0);
    const confidence = computeConfidence({
      commentCount: frustData.total,
      demandSourceCount,
      dataAgeHours: dataAgeByTopic.get(topic.id) ?? 999,
    });

    // Compute feasibility
    const ownerSubs = topic.owner_channel ? (ownerSubsByChannel.get(topic.owner_channel) ?? null) : null;
    const compSubs = competitorSubsByTopic.get(topic.id) ?? [];
    const feasibility = computeFeasibility(ownerSubs, compSubs, qualifiedRecent);

    // Write topic_scores row
    await db.from('topic_scores').upsert(
      {
        topic_id: topic.id,
        scored_at: today,
        demand,
        frustration,
        supply_q: supplyQualified,
        monetization: topic.rpm_coefficient,
        mgi,
        phase,
        confidence: confidence.level,
        confidence_reason: confidence.reason,
        feasibility_grade: feasibility.grade,
        feasibility_reason: feasibility.reason,
      },
      { onConflict: 'topic_id,scored_at' },
    );

    // Update topic phase
    await db
      .from('topics')
      .update({ phase })
      .eq('id', topic.id);

    result.topicsScored++;

    // Collect for alert evaluation
    scoredTopicsForAlerts.push({
      id: topic.id,
      label: topic.label,
      niche_id: topic.niche_id,
      phase,
      previousPhase: previousPhaseByTopic.get(topic.id) ?? null,
      qualifiedIn72h,
    });

    // ── Burn-down detection ─────────────────────────────────────
    if (qualifiedIn72h >= 5 && topic.status === 'in_production') {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tublyti.vercel.app';
      await alertSender.send({
        kind: 'burn_down',
        subject: `Sujet ${topic.label} : ${qualifiedIn72h} chaines ont publie en 72 h`,
        body: `Sujet « ${topic.label} » : ${qualifiedIn72h} videos qualifiees publiees dans les 72 dernieres heures. Fenetre en train de se fermer.`,
        actionUrl: `${baseUrl}/topics/${topic.id}`,
        actionLabel: 'Voir la fiche sujet',
      });
      result.burnDownAlerts++;
    }
  }

  // ── Silent collection detection ──────────────────────────────
  const thirtyySixHoursAgo = new Date(Date.now() - 36 * 3_600_000).toISOString();
  const { data: recentSnap } = await db
    .from('video_snapshots')
    .select('video_id')
    .gte('captured_at', thirtyySixHoursAgo)
    .limit(1);

  if (!recentSnap || recentSnap.length === 0) {
    await alertSender.send({
      kind: 'silent_collection',
      subject: 'Collecte silencieuse depuis 36 h',
      body: 'Aucun snapshot video enregistre dans les 36 dernieres heures. Le cron collect est peut-etre en echec.',
      actionUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://tublyti.vercel.app'}/admin/jobs`,
      actionLabel: 'Voir les jobs',
    });
    result.silentCollectionAlert = true;
  }

  // ── Evaluate alert rules ──────────────────────────────────────
  // Gather video outlier data for video_outlier rules
  const videoOutliersForAlerts: {
    videoId: string;
    title: string;
    views: number;
    channelTitle: string;
    subscriberCount: number;
    avgViews: number;
  }[] = [];

  const { data: recentOutliers } = await db
    .from('video_outliers')
    .select('video_id, score, baseline, videos!inner(title, channel_id, channels!inner(title, subscriber_count))')
    .gte('score', 3)
    .gte('computed_at', new Date(Date.now() - 24 * 3_600_000).toISOString());

  for (const o of recentOutliers ?? []) {
    const video = o.videos as unknown as {
      title: string;
      channel_id: string;
      channels: { title: string; subscriber_count: number | null };
    };
    videoOutliersForAlerts.push({
      videoId: o.video_id,
      title: video.title,
      views: Math.round(Number(o.score) * Number(o.baseline)),
      channelTitle: video.channels.title,
      subscriberCount: Number(video.channels.subscriber_count) || 0,
      avgViews: Math.round(Number(o.baseline)),
    });
  }

  try {
    const alertResult = await evaluateAlertRules(
      db,
      alertSender,
      scoredTopicsForAlerts,
      videoOutliersForAlerts,
    );
    result.alertEventsCreated = alertResult.eventsCreated;
    result.alertInstantEmails = alertResult.instantEmailsSent;
  } catch (err) {
    console.error('[Score] Alert evaluation failed:', err instanceof Error ? err.message : err);
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────

function combineSocial(
  reddit: number | undefined,
  hn: number | undefined,
): number | null {
  if (reddit === undefined && hn === undefined) return null;
  return (reddit ?? 0) + (hn ?? 0);
}
