import { SupabaseClient } from '@supabase/supabase-js';
import {
  computeMGI,
  computeYTDemand,
  computeFrustration,
  computeSupplyQ,
  computeConfidence,
  computePercentile,
  MIN_TOPICS_FOR_RANK,
  type TopicYTDemand,
} from './mgi';
import { computePhase, type PhaseThresholds } from './phase';
import { DEFAULT_SCORING } from './scoring-config';
import { computeFeasibility } from './feasibility';
import type { AlertSender } from '../email/alerts';
import { evaluateAlertRules } from '../alerts/evaluate';
import { median } from './outlier';

// ── Types ────────────────────────────────────────────────────────────

export interface ScoreResult {
  topicsScored: number;
  topicsSkipped: number;
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

// ── Helpers ──────────────────────────────────────────────────────────

const PAGE_SIZE = 1000;

/**
 * Fails loudly on a read error: a timeout on `comments` must not become "0 comments"
 * and be saved as a true (lower) MGI. The job is then marked as failed.
 */
function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (res.error) throw new Error(`Lecture ${what} impossible : ${res.error.message}`);
  return res.data;
}

async function fetchAllRows<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  filterFn?: (q: ReturnType<SupabaseClient['from']>) => unknown,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    let query: unknown = db.from(table).select(columns);
    if (filterFn) query = filterFn(query as ReturnType<SupabaseClient['from']>);
    const data = must(
      await (query as ReturnType<ReturnType<SupabaseClient['from']>['select']>).range(offset, offset + PAGE_SIZE - 1),
      table,
    );
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

/** Up to n values picked at uniform quantiles of a sorted array (keeps min, max and the shape). */
export function quantileSample(sorted: number[], n: number): number[] {
  if (sorted.length <= n) return sorted;
  return Array.from({ length: n }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]);
}

// ── Main service ─────────────────────────────────────────────────────

export async function runScore(
  db: SupabaseClient,
  alertSender: AlertSender,
): Promise<ScoreResult> {
  const result: ScoreResult = {
    topicsScored: 0,
    topicsSkipped: 0,
    burnDownAlerts: 0,
    silentCollectionAlert: false,
    alertEventsCreated: 0,
    alertInstantEmails: 0,
  };
  const today = new Date().toISOString().slice(0, 10);

  // ── Load active topics with niche info ──────────────────────────
  const topicsRaw = must(
    await db
      .from('topics')
      .select('id, label, niche_id, status, niches!inner(rpm_coefficient, owner_channel)')
      .in('status', ['active', 'in_production']),
    'topics',
  );

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

  // ── Thresholds from Réglages (fallback: defaults) ──────────────
  const thrRow = must(await db.from('settings').select('value').eq('key', 'thresholds').maybeSingle(), 'settings (seuils)') as
    | { value?: Partial<PhaseThresholds> | null }
    | null;
  const thresholds: PhaseThresholds = {
    phase2MaxSupply: Number(thrRow?.value?.phase2MaxSupply ?? DEFAULT_SCORING.thresholds.phase2MaxSupply),
    phase3QualifiedIn72h: Number(thrRow?.value?.phase3QualifiedIn72h ?? DEFAULT_SCORING.thresholds.phase3QualifiedIn72h),
  };

  const cutoff90d = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const cutoff30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const cutoff4w = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const cutoff12w = new Date(Date.now() - 84 * 86_400_000).toISOString();

  // ── Load all videos for these topics ────────────────────────────
  interface TopicVideo {
    id: string;
    topic_id: string;
    channel_id: string;
    published_at: string;
    duration_s: number | null;
    is_qualified: boolean;
  }

  const IN_BATCH_TOPIC = 200;
  const allVideos: TopicVideo[] = [];
  for (let i = 0; i < topicIds.length; i += IN_BATCH_TOPIC) {
    const batch = topicIds.slice(i, i + IN_BATCH_TOPIC);
    let offset = 0;
    while (true) {
      const data = must(
        await db
          .from('videos')
          .select('id, topic_id, channel_id, published_at, duration_s, is_qualified')
          .in('topic_id', batch)
          .order('id')
          .range(offset, offset + PAGE_SIZE - 1),
        'videos',
      );
      if (!data || data.length === 0) break;
      allVideos.push(...(data as TopicVideo[]));
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  // Group videos by topic
  const videosByTopic = new Map<string, TopicVideo[]>();

  for (const v of allVideos) {
    if (!v.topic_id) continue;
    if (!videosByTopic.has(v.topic_id)) videosByTopic.set(v.topic_id, []);
    videosByTopic.get(v.topic_id)!.push(v);
  }

  const cutoff72h = new Date(Date.now() - 72 * 3_600_000).toISOString();
  const qualified72h = (topicId: string) =>
    (videosByTopic.get(topicId) ?? []).filter((v) => v.published_at >= cutoff72h && v.is_qualified).length;

  // ── Load channel subscriber counts ──────────────────────────────
  const channelIds = [...new Set(allVideos.map((v) => v.channel_id))];
  const channelSubs = new Map<string, number>();
  for (let i = 0; i < channelIds.length; i += IN_BATCH_TOPIC) {
    const batch = channelIds.slice(i, i + IN_BATCH_TOPIC);
    const channels = must(await db.from('channels').select('id, subscriber_count').in('id', batch), 'channels');
    for (const ch of channels ?? []) {
      channelSubs.set(ch.id, Number(ch.subscriber_count) || 0);
    }
  }

  // ── Load video snapshots for velocity (videos < 30d) ────────────
  const recentVideoIds = allVideos
    .filter((v) => v.published_at >= cutoff30d)
    .map((v) => v.id);

  // Only the latest snapshot is used: read the last 7 days, newest first (not the whole history).
  const snapSince = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const viewsByVideo = new Map<string, number>();
  for (let i = 0; i < recentVideoIds.length; i += IN_BATCH_TOPIC) {
    const batch = recentVideoIds.slice(i, i + IN_BATCH_TOPIC);
    let offset = 0;
    while (true) {
      const snaps = must(
        await db
          .from('video_snapshots')
          .select('video_id, views')
          .in('video_id', batch)
          .gte('captured_at', snapSince)
          .order('captured_at', { ascending: false })
          .order('video_id')
          .range(offset, offset + PAGE_SIZE - 1),
        'video_snapshots',
      );
      if (!snaps || snaps.length === 0) break;
      for (const s of snaps) {
        if (!viewsByVideo.has(s.video_id)) {
          viewsByVideo.set(s.video_id, Number(s.views) || 0);
        }
      }
      if (snaps.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  // ── Load outlier scores ─────────────────────────────────────────
  const allVideoIds = allVideos.map((v) => v.id);
  const outlierByVideo = new Map<string, { score: number; ageDays: number }>();
  for (let i = 0; i < allVideoIds.length; i += IN_BATCH_TOPIC) {
    const batch = allVideoIds.slice(i, i + IN_BATCH_TOPIC);
    let offset = 0;
    while (true) {
      const outliers = must(
        await db
          .from('video_outliers')
          .select('video_id, score, age_days')
          .in('video_id', batch)
          .order('video_id')
          .range(offset, offset + PAGE_SIZE - 1),
        'video_outliers',
      );
      if (!outliers || outliers.length === 0) break;
      for (const o of outliers) {
        outlierByVideo.set(o.video_id, { score: Number(o.score), ageDays: Number(o.age_days) });
      }
      if (outliers.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  // ── Frustration per topic (like-weighted) ───────────────────────
  const frustrationByTopic = new Map<string, { frustWeighted: number; totalWeighted: number; commentCount: number }>();
  {
    const topicVideoIdSet = new Set(allVideoIds);
    // Fetch comments for topic videos — use small batches to avoid
    // Supabase 1000-row cap when .in() matches many rows per ID
    const IN_BATCH = 200;
    interface CommentRow { id: string; video_id: string; like_count: number }
    const comments: CommentRow[] = [];
    const vidIdArr = [...topicVideoIdSet];
    for (let i = 0; i < vidIdArr.length; i += IN_BATCH) {
      const batch = vidIdArr.slice(i, i + IN_BATCH);
      let offset = 0;
      while (true) {
        const data = must(
          await db
            .from('comments')
            .select('id, video_id, like_count')
            .in('video_id', batch)
            .order('id')
            .range(offset, offset + PAGE_SIZE - 1),
          'comments',
        );
        if (!data || data.length === 0) break;
        comments.push(...(data as CommentRow[]));
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
    }

    const commentVideoMap = new Map<string, string>();
    const commentLikeMap = new Map<string, number>();
    for (const c of comments) {
      commentVideoMap.set(c.id, c.video_id);
      commentLikeMap.set(c.id, Number(c.like_count) || 0);
    }

    // Count comments per topic
    const videoToTopic = new Map<string, string>();
    for (const v of allVideos) {
      if (v.topic_id) videoToTopic.set(v.id, v.topic_id);
    }
    for (const c of comments) {
      const topicId = videoToTopic.get(c.video_id);
      if (!topicId) continue;
      if (!frustrationByTopic.has(topicId)) {
        frustrationByTopic.set(topicId, { frustWeighted: 0, totalWeighted: 0, commentCount: 0 });
      }
      frustrationByTopic.get(topicId)!.commentCount++;
    }

    // Fetch labels — also paginate within each batch
    const commentIds = comments.map((c) => c.id);
    interface LabelRow { comment_id: string; label: string; confidence: number; model: string | null }
    const labels: LabelRow[] = [];
    for (let i = 0; i < commentIds.length; i += IN_BATCH) {
      const batch = commentIds.slice(i, i + IN_BATCH);
      let offset = 0;
      while (true) {
        const data = must(
          await db
            .from('comment_labels')
            .select('comment_id, label, confidence, model')
            .in('comment_id', batch)
            .order('comment_id')
            .range(offset, offset + PAGE_SIZE - 1),
          'comment_labels',
        );
        if (!data || data.length === 0) break;
        labels.push(...(data as LabelRow[]));
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
    }

    for (const label of labels) {
      // Unreadable answers (stored only so they are not re-billed) and zero-confidence labels
      // say nothing about frustration: they must not dilute the denominator.
      if ((label.model ?? '').endsWith('-unparsable') || !(Number(label.confidence) > 0)) continue;
      const videoId = commentVideoMap.get(label.comment_id);
      if (!videoId) continue;
      const topicId = videoToTopic.get(videoId);
      if (!topicId) continue;

      const likeWeight = 1 + (commentLikeMap.get(label.comment_id) ?? 0);
      if (!frustrationByTopic.has(topicId)) {
        frustrationByTopic.set(topicId, { frustWeighted: 0, totalWeighted: 0, commentCount: 0 });
      }
      const entry = frustrationByTopic.get(topicId)!;
      entry.totalWeighted += likeWeight;
      if (label.label !== 'none' && label.confidence >= 0.5) {
        entry.frustWeighted += likeWeight;
      }
    }
  }

  // ── Compute per-topic signals ───────────────────────────────────

  interface TopicComputed {
    topicIndex: number;
    ytDemand: TopicYTDemand;
    longQualityCount: number;
    videoCount: number;
    frustration: number;
    uploadsRecent4w: number;
    uploadsOlder8w: number;
    medianOutlierAgeDays: number | null;
    hasOutlierData: boolean;
    commentCount: number;
  }

  const computed: TopicComputed[] = [];

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const videos = videosByTopic.get(topic.id) ?? [];
    const videoCount = videos.length;

    // Velocity: median views/day for videos < 30 days
    const recentVids = videos.filter((v) => v.published_at >= cutoff30d);
    const velocities: number[] = [];
    for (const v of recentVids) {
      const views = viewsByVideo.get(v.id);
      if (views !== undefined && views > 0) {
        const ageDays = Math.max(1, Math.floor((Date.now() - new Date(v.published_at).getTime()) / 86_400_000));
        velocities.push(views / ageDays);
      }
    }
    const velocity = median(velocities);

    // Outlier ratio & count
    const outlierScores: number[] = [];
    const outlierAges: number[] = [];
    let outlierCount = 0;
    for (const v of videos) {
      const o = outlierByVideo.get(v.id);
      if (o) {
        outlierScores.push(o.score);
        if (o.score >= 3) {
          outlierCount++;
          outlierAges.push(o.ageDays);
        }
      }
    }
    const outlierRatio = median(outlierScores);
    const medianOutlierAge = outlierAges.length > 0 ? median(outlierAges) : null;

    // Supply: long quality videos (>= 8min, channel >= 10k subs) in 90d
    let longQualityCount = 0;
    for (const v of videos) {
      if (v.published_at < cutoff90d) continue;
      if ((v.duration_s ?? 0) < 480) continue;
      const subs = channelSubs.get(v.channel_id) ?? 0;
      if (subs >= 10_000) longQualityCount++;
    }

    // Upload slope
    const uploadsRecent4w = videos.filter((v) => v.published_at >= cutoff4w).length;
    const uploadsOlder8w = videos.filter((v) => v.published_at >= cutoff12w && v.published_at < cutoff4w).length;

    // Frustration
    const frustData = frustrationByTopic.get(topic.id) ?? { frustWeighted: 0, totalWeighted: 0, commentCount: 0 };
    const frustration = computeFrustration(frustData.frustWeighted, frustData.totalWeighted);

    computed.push({
      topicIndex: i,
      ytDemand: { velocity, outlierRatio, outlierCount },
      longQualityCount,
      videoCount,
      frustration,
      uploadsRecent4w,
      uploadsOlder8w,
      medianOutlierAgeDays: medianOutlierAge,
      hasOutlierData: outlierScores.length > 0,
      commentCount: frustData.commentCount,
    });
  }

  // ── Niche-level aggregates ──────────────────────────────────────
  const demandByNiche = new Map<string, TopicYTDemand[]>();
  const longQualityByNiche = new Map<string, number[]>();

  for (const c of computed) {
    const nicheId = topics[c.topicIndex].niche_id;
    // Only include scoreable topics (>= 5 videos) in percentile base
    if (c.videoCount >= 5) {
      if (!demandByNiche.has(nicheId)) demandByNiche.set(nicheId, []);
      demandByNiche.get(nicheId)!.push(c.ytDemand);
      if (!longQualityByNiche.has(nicheId)) longQualityByNiche.set(nicheId, []);
      longQualityByNiche.get(nicheId)!.push(c.longQualityCount);
    }
  }

  const nicheMedianSupply = new Map<string, number>();
  for (const [nicheId, counts] of longQualityByNiche) {
    nicheMedianSupply.set(nicheId, median(counts));
  }

  // ── Owner channel subs for feasibility ──────────────────────────
  const ownerChannelIds = [...new Set(topics.map((t) => t.owner_channel).filter(Boolean))] as string[];
  const ownerSubsByChannel = new Map<string, number>();
  if (ownerChannelIds.length > 0) {
    const ownerChannels = must(
      await db.from('channels').select('title, subscriber_count').in('title', ownerChannelIds),
      'channels (propriétaires)',
    );
    for (const ch of ownerChannels ?? []) {
      ownerSubsByChannel.set(ch.title, Number(ch.subscriber_count) || 0);
    }
  }

  // ── Previous phases for alert evaluation ────────────────────────
  const previousPhaseByTopic = new Map<string, number>();
  {
    // Last score before today, in batches of 200 topics (URL length) over the last 14 days,
    // paginated (the 1 000-row cap used to drop most topics, so phase alerts never fired).
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    for (let i = 0; i < topicIds.length; i += IN_BATCH_TOPIC) {
      const batch = topicIds.slice(i, i + IN_BATCH_TOPIC);
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const prevScores = must(
          await db
            .from('topic_scores')
            .select('topic_id, phase, scored_at')
            .in('topic_id', batch)
            .lt('scored_at', today)
            .gte('scored_at', since)
            .order('scored_at', { ascending: false })
            .order('topic_id')
            .range(offset, offset + PAGE_SIZE - 1),
          'topic_scores (veille)',
        ) ?? [];
        for (const s of prevScores) {
          if (!previousPhaseByTopic.has(s.topic_id) && s.phase !== null) {
            previousPhaseByTopic.set(s.topic_id, s.phase as number);
          }
        }
        if (prevScores.length < PAGE_SIZE) break;
      }
    }
  }

  const scoredTopicsForAlerts: {
    id: string;
    label: string;
    niche_id: string;
    phase: number;
    previousPhase: number | null;
    qualifiedIn72h: number;
  }[] = [];

  // ── Pass 1: Compute raw MGI for scoreable topics ────────────────

  interface ScoredTopic {
    topicIndex: number;
    demand: number;
    frustration: number;
    supplyQ: number;
    rawMgi: number;
    phase: number;
    confidence: ReturnType<typeof computeConfidence>;
    feasibility: ReturnType<typeof computeFeasibility>;
    competitorSubs: number[];
  }

  const scored: ScoredTopic[] = [];
  // Écritures groupées : une requête par lot au lieu de deux par sujet (17 min → quelques secondes).
  const insufficientRows: Record<string, unknown>[] = [];

  for (const c of computed) {
    const topic = topics[c.topicIndex];
    const nicheId = topic.niche_id;

    const confidence = computeConfidence({
      videoCount: c.videoCount,
      commentCount: c.commentCount,
      hasOutlierData: c.hasOutlierData,
    });

    const phaseInputs = {
      uploadsRecent4w: c.uploadsRecent4w,
      uploadsOlder8w: c.uploadsOlder8w,
      medianOutlierAgeDays: c.medianOutlierAgeDays,
      totalVideos: c.videoCount,
      qualifiedIn72h: qualified72h(topic.id),
    };

    if (confidence.level === 'insufficient') {
      const phase = computePhase({ ...phaseInputs, supplyQ: null }, thresholds);
      insufficientRows.push(
        {
          topic_id: topic.id,
          scored_at: today,
          demand: 0,
          frustration: c.frustration,
          supply_q: 0,
          monetization: topic.rpm_coefficient,
          mgi: null,
          phase,
          confidence: 'insufficient',
          confidence_reason: confidence.reason,
          feasibility_grade: null,
          feasibility_reason: null,
        },
      );
      result.topicsSkipped++;
      continue;
    }

    const nicheSignals = demandByNiche.get(nicheId) ?? [c.ytDemand];
    const demand = computeYTDemand(c.ytDemand, nicheSignals);
    const nicheMedian = nicheMedianSupply.get(nicheId) ?? 1;
    const supplyQ = computeSupplyQ(c.longQualityCount, nicheMedian);
    const phase = computePhase({ ...phaseInputs, supplyQ }, thresholds);

    const rawMgi = computeMGI({
      demand,
      frustration: c.frustration,
      supplyQualified: supplyQ,
      monetization: topic.rpm_coefficient,
    });

    const ownerSubs = topic.owner_channel ? (ownerSubsByChannel.get(topic.owner_channel) ?? null) : null;
    // One value per competing channel (a big channel with 15 videos used to weigh 15 times).
    const subsByChannel = new Map<string, number>();
    const videos = videosByTopic.get(topic.id) ?? [];
    for (const v of videos) {
      if (v.published_at >= cutoff90d && (v.duration_s ?? 0) >= 480) {
        const subs = channelSubs.get(v.channel_id) ?? 0;
        if (subs >= 10_000) subsByChannel.set(v.channel_id, Math.max(subsByChannel.get(v.channel_id) ?? 0, subs));
      }
    }
    const compSubs = [...subsByChannel.values()];
    const feasibility = computeFeasibility(ownerSubs, compSubs, c.longQualityCount);

    // Sorted, capped at 200 by uniform quantiles (not the 200 smallest: that made big
    // topics look easy in the per-user feasibility computed at display time).
    const competitorSubs = quantileSample([...compSubs].sort((a, b) => a - b), 200);

    scored.push({
      topicIndex: c.topicIndex,
      demand,
      frustration: c.frustration,
      supplyQ,
      rawMgi,
      phase,
      confidence,
      feasibility,
      competitorSubs,
    });
  }

  // ── Pass 2: Normalize MGI to 0-100 percentile within niche ──────
  const rawMgiByNiche = new Map<string, number[]>();
  for (const s of scored) {
    const nicheId = topics[s.topicIndex].niche_id;
    if (!rawMgiByNiche.has(nicheId)) rawMgiByNiche.set(nicheId, []);
    rawMgiByNiche.get(nicheId)!.push(s.rawMgi);
  }

  // ── Pass 3: Write scores to DB ──────────────────────────────────
  // Burn-down e-mails: at most one per topic per 72 h (the window is 72 h, so it used to repeat 2-3 nights).
  const burnRow = must(await db.from('settings').select('value').eq('key', 'burn_down_sent').maybeSingle(), 'settings (burn-down)') as
    | { value?: Record<string, string> | null }
    | null;
  const burnSent: Record<string, string> = { ...(burnRow?.value ?? {}) };
  let burnChanged = false;
  const scoreRows: Record<string, unknown>[] = [];
  const idsByPhase = new Map<ScoredTopic["phase"], string[]>();

  for (const s of scored) {
    const topic = topics[s.topicIndex];
    const nicheRawValues = rawMgiByNiche.get(topic.niche_id) ?? [s.rawMgi];
    // A rank among fewer than 3 topics means nothing (a lone topic always got 50).
    const tooFew = nicheRawValues.length < MIN_TOPICS_FOR_RANK;
    const mgi = tooFew ? null : computePercentile(s.rawMgi, nicheRawValues);
    if (tooFew) {
      s.confidence = {
        level: 'insufficient',
        reason: `${nicheRawValues.length} sujet${nicheRawValues.length > 1 ? 's' : ''} comparable${nicheRawValues.length > 1 ? 's' : ''} dans la niche (min ${MIN_TOPICS_FOR_RANK})`,
      };
    }

    scoreRows.push({
        topic_id: topic.id,
        scored_at: today,
        demand: s.demand,
        frustration: s.frustration,
        supply_q: s.supplyQ,
        monetization: topic.rpm_coefficient,
        mgi,
        phase: s.phase,
        confidence: s.confidence.level,
        confidence_reason: s.confidence.reason,
        feasibility_grade: s.feasibility.grade,
        feasibility_reason: s.feasibility.reason,
        competitor_subs: s.competitorSubs,
    });
    idsByPhase.set(s.phase, [...(idsByPhase.get(s.phase) ?? []), topic.id]);
    result.topicsScored++;

    const qualifiedIn72h = qualified72h(topic.id);

    scoredTopicsForAlerts.push({
      id: topic.id,
      label: topic.label,
      niche_id: topic.niche_id,
      phase: s.phase,
      previousPhase: previousPhaseByTopic.get(topic.id) ?? null,
      qualifiedIn72h,
    });

    const lastBurn = burnSent[topic.id];
    const recentlySent = lastBurn !== undefined && Date.now() - new Date(lastBurn).getTime() < 72 * 3_600_000;
    if (qualifiedIn72h >= thresholds.phase3QualifiedIn72h && topic.status === 'in_production' && !recentlySent) {
      burnSent[topic.id] = new Date().toISOString();
      burnChanged = true;
      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://tublyti.vercel.app').replace(/\/+$/, '');
      await alertSender.send({
        kind: 'burn_down',
        subject: `Sujet ${topic.label} : ${qualifiedIn72h} chaines ont publie en 72 h`,
        body: `Sujet « ${topic.label} » : ${qualifiedIn72h} videos qualifiees publiees dans les 72 dernieres heures.`,
        actionUrl: `${baseUrl}/topics/${topic.id}`,
        actionLabel: 'Voir la fiche sujet',
      });
      result.burnDownAlerts++;
    }
  }

  if (burnChanged) {
    // Forget entries older than 7 days so the map stays small.
    for (const [k, v] of Object.entries(burnSent)) if (Date.now() - new Date(v).getTime() > 7 * 86_400_000) delete burnSent[k];
    const { error } = await db.from('settings').upsert({ key: 'burn_down_sent', value: burnSent });
    if (error) console.error('[Score] burn_down_sent :', error.message);
  }

  // Écriture des scores et des phases par lots.
  const BATCH = 500;
  for (const rows of [insufficientRows, scoreRows]) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await db.from('topic_scores').upsert(rows.slice(i, i + BATCH), { onConflict: 'topic_id,scored_at' });
      if (error) throw new Error(`topic_scores : ${error.message}`);
    }
  }
  for (const [phase, ids] of idsByPhase) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await db.from('topics').update({ phase }).in('id', ids.slice(i, i + 200));
      if (error) throw new Error(`topics.phase : ${error.message}`);
    }
  }

  // ── Silent collection detection ──────────────────────────────
  const thirtySixHoursAgo = new Date(Date.now() - 36 * 3_600_000).toISOString();
  const { data: recentSnap, error: recentSnapErr } = await db
    .from('video_snapshots')
    .select('video_id')
    .gte('captured_at', thirtySixHoursAgo)
    .limit(1);

  // A read error is not "no snapshot": no false alert.
  if (!recentSnapErr && (!recentSnap || recentSnap.length === 0)) {
    await alertSender.send({
      kind: 'silent_collection',
      subject: 'Collecte silencieuse depuis 36 h',
      body: 'Aucun snapshot video enregistre dans les 36 dernieres heures.',
      actionUrl: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://tublyti.vercel.app').replace(/\/+$/, '')}/admin/jobs`,
      actionLabel: 'Voir les jobs',
    });
    result.silentCollectionAlert = true;
  }

  // ── Evaluate alert rules ──────────────────────────────────────
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
