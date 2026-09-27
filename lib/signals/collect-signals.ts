import { SupabaseClient } from '@supabase/supabase-js';
import type { TrendProvider } from '../providers/trends';
import type { SocialProvider } from '../providers/social';
import { SerpApiTrendProvider } from '../providers/serpapi-trends';
import { SearchApiTrendProvider } from '../providers/searchapi-trends';
import { FakeTrendProvider } from '../providers/trends';
import { RealSocialProvider } from '../providers/real-social';
import { FakeSocialProvider } from '../providers/social';

// ── Types ────────────────────────────────────────────────────────────
export interface SignalResult {
  trendPointsCollected: number;
  socialPointsCollected: number;
  ytViewPointsCollected: number;
}

interface TopicQuery {
  topicId: string;
  queryText: string;
  source: string;
  nicheCategory: string;
}

// ── Provider factory ─────────────────────────────────────────────────
function createTrendProvider(): TrendProvider {
  const provider = process.env.TREND_PROVIDER ?? 'serpapi';
  switch (provider) {
    case 'serpapi':
      return new SerpApiTrendProvider();
    case 'searchapi':
      return new SearchApiTrendProvider();
    case 'fake':
      return new FakeTrendProvider();
    default:
      return new FakeTrendProvider();
  }
}

function createSocialProvider(): SocialProvider {
  const hasReddit = process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET;
  if (hasReddit) return new RealSocialProvider();
  return new FakeSocialProvider();
}

// ── Main service ─────────────────────────────────────────────────────
export async function collectSignals(
  db: SupabaseClient,
  deadlineMs: number,
): Promise<SignalResult> {
  const result: SignalResult = {
    trendPointsCollected: 0,
    socialPointsCollected: 0,
    ytViewPointsCollected: 0,
  };

  const isTimedOut = () => Date.now() >= deadlineMs;
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Load active topics with their queries and niche info
  const { data: queries } = await db
    .from('topic_queries')
    .select('topic_id, query_text, source, topics!inner(status, niche_id, niches!inner(category))')
    .eq('topics.status', 'active');

  if (!queries || queries.length === 0) return result;

  const topicQueries: TopicQuery[] = queries.map((q) => {
    const topic = q.topics as unknown as {
      niche_id: string;
      niches: { category: string };
    };
    return {
      topicId: q.topic_id,
      queryText: q.query_text,
      source: q.source,
      nicheCategory: topic.niches.category,
    };
  });

  // ── Step 6: Google Trends ────────────────────────────────────────
  const trendQueries = topicQueries.filter((q) => q.source === 'trends');

  if (trendQueries.length > 0) {
    // Only collect once per week per topic
    const trendTopicIds = [...new Set(trendQueries.map((q) => q.topicId))];
    const { data: existingTrends } = await db
      .from('trend_points')
      .select('topic_id')
      .in('topic_id', trendTopicIds)
      .eq('source', 'trends')
      .gte('captured_at', sevenDaysAgo);
    const hasRecentTrend = new Set(
      (existingTrends ?? []).map((t) => t.topic_id),
    );

    const needsTrend = trendQueries.filter(
      (q) => !hasRecentTrend.has(q.topicId),
    );

    if (needsTrend.length > 0) {
      let trends: TrendProvider;
      try {
        trends = createTrendProvider();
      } catch {
        console.error('TrendProvider unavailable, skipping trends');
        trends = new FakeTrendProvider();
      }

      for (const q of needsTrend) {
        if (isTimedOut()) break;
        try {
          const points = await trends.getInterestOverTime(q.queryText, 90);
          // Store the most recent point as today's value
          const latestPoint = points[points.length - 1];
          if (latestPoint) {
            await db.from('trend_points').upsert(
              {
                topic_id: q.topicId,
                source: 'trends',
                captured_at: today,
                value: latestPoint.value,
              },
              { onConflict: 'topic_id,source,captured_at' },
            );
            result.trendPointsCollected++;
          }
        } catch (err) {
          console.error(
            `Trend error for "${q.queryText}": ${(err as Error).message}`,
          );
        }
      }
    }
  }

  if (isTimedOut()) return result;

  // ── Step 7: Social signals (Reddit + HN) ─────────────────────────
  const socialQueries = topicQueries.filter(
    (q) => q.source === 'reddit' || q.source === 'hn',
  );

  // Also generate social queries for topics that only have 'youtube' or 'trends' source
  // by reusing their query_text with reddit and hn
  const topicsWithSocial = new Set(socialQueries.map((q) => q.topicId));
  const extraSocialQueries: TopicQuery[] = [];
  for (const q of topicQueries) {
    if (!topicsWithSocial.has(q.topicId)) {
      extraSocialQueries.push({ ...q, source: 'reddit' });
      extraSocialQueries.push({ ...q, source: 'hn' });
      topicsWithSocial.add(q.topicId);
    }
  }
  const allSocialQueries = [...socialQueries, ...extraSocialQueries];

  if (allSocialQueries.length > 0) {
    // Only collect once per day per topic+source
    const socialTopicIds = [
      ...new Set(allSocialQueries.map((q) => q.topicId)),
    ];
    const { data: existingSocial } = await db
      .from('trend_points')
      .select('topic_id, source')
      .in('topic_id', socialTopicIds)
      .in('source', ['reddit', 'hn'])
      .eq('captured_at', today);
    const hasTodaySocial = new Set(
      (existingSocial ?? []).map((s) => `${s.topic_id}:${s.source}`),
    );

    const needsSocial = allSocialQueries.filter(
      (q) => !hasTodaySocial.has(`${q.topicId}:${q.source}`),
    );

    const social = createSocialProvider();

    for (const q of needsSocial) {
      if (isTimedOut()) break;
      try {
        const mention = await social.countMentions(
          q.queryText,
          q.source as 'reddit' | 'hn',
          q.nicheCategory,
        );
        await db.from('trend_points').upsert(
          {
            topic_id: q.topicId,
            source: q.source,
            captured_at: today,
            value: mention.count,
          },
          { onConflict: 'topic_id,source,captured_at' },
        );
        result.socialPointsCollected++;
      } catch (err) {
        console.error(
          `Social error (${q.source}) for "${q.queryText}": ${(err as Error).message}`,
        );
      }
    }
  }

  if (isTimedOut()) return result;

  // ── Step 8: yt_views from video_snapshots ─────────────────────────
  // For each topic that has videos, compute avg daily views
  const { data: topicVideos } = await db
    .from('videos')
    .select('topic_id, id')
    .not('topic_id', 'is', null);

  if (topicVideos && topicVideos.length > 0) {
    // Group videos by topic
    const byTopic = new Map<string, string[]>();
    for (const v of topicVideos) {
      if (!v.topic_id) continue;
      if (!byTopic.has(v.topic_id)) byTopic.set(v.topic_id, []);
      byTopic.get(v.topic_id)!.push(v.id);
    }

    // Check which topics already have yt_views for today
    const topicIds = [...byTopic.keys()];
    const { data: existingYt } = await db
      .from('trend_points')
      .select('topic_id')
      .in('topic_id', topicIds)
      .eq('source', 'yt_views')
      .eq('captured_at', today);
    const hasYtToday = new Set(
      (existingYt ?? []).map((t) => t.topic_id),
    );

    for (const [topicId, videoIds] of byTopic) {
      if (isTimedOut()) break;
      if (hasYtToday.has(topicId)) continue;

      // Get latest snapshot for each video
      const { data: snapshots } = await db
        .from('video_snapshots')
        .select('video_id, views')
        .in('video_id', videoIds)
        .order('captured_at', { ascending: false });

      if (!snapshots || snapshots.length === 0) continue;

      // Deduplicate: keep latest snapshot per video
      const latestByVideo = new Map<string, number>();
      for (const s of snapshots) {
        if (!latestByVideo.has(s.video_id)) {
          latestByVideo.set(s.video_id, s.views ?? 0);
        }
      }

      const totalViews = [...latestByVideo.values()].reduce(
        (sum, v) => sum + v,
        0,
      );
      const avgViews = Math.round(totalViews / latestByVideo.size);

      await db.from('trend_points').upsert(
        {
          topic_id: topicId,
          source: 'yt_views',
          captured_at: today,
          value: avgViews,
        },
        { onConflict: 'topic_id,source,captured_at' },
      );
      result.ytViewPointsCollected++;
    }
  }

  return result;
}
