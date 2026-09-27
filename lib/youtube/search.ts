import { SupabaseClient } from '@supabase/supabase-js';
import { QuotaSoftLimitReached, getQuotaSoftLimit } from './quota';

/**
 * YouTube search.list — the ONLY file allowed to call search.list.
 * AI_RULES #6: plafonne à 100 appels par jour, journalise chaque appel.
 */

const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const DAILY_SEARCH_LIMIT = 100;
const SEARCH_QUOTA_COST = 100; // search.list costs 100 quota units

export interface SearchResult {
  videoId: string;
  title: string;
  channelId: string;
  publishedAt: string;
}

export interface SearchStats {
  searchesPerformed: number;
  videosDiscovered: number;
}

export async function runYouTubeSearch(
  db: SupabaseClient,
  deadlineMs: number,
  currentQuotaUsed: number,
): Promise<SearchStats> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { searchesPerformed: 0, videosDiscovered: 0 };

  const softLimit = getQuotaSoftLimit();
  const isTimedOut = () => Date.now() >= deadlineMs;
  let quotaUsed = currentQuotaUsed;

  const stats: SearchStats = { searchesPerformed: 0, videosDiscovered: 0 };

  // Check how many searches we've already done today
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: todaySearchSetting } = await db
    .from('settings')
    .select('value')
    .eq('key', `search_count_${todayStart.toISOString().slice(0, 10)}`)
    .single();
  let searchesToday = typeof todaySearchSetting?.value === 'number'
    ? todaySearchSetting.value
    : 0;

  if (searchesToday >= DAILY_SEARCH_LIMIT) return stats;

  // Load active topic queries, prioritized by phase (0-2 first)
  const { data: queries } = await db
    .from('topic_queries')
    .select(`
      id, query_text, source,
      topics!inner(id, phase, status)
    `)
    .eq('source', 'youtube')
    .eq('topics.status', 'active')
    .order('priority', { ascending: true });

  if (!queries || queries.length === 0) return stats;

  // Sort by phase (0-2 first, then rest)
  const sorted = queries.sort((a, b) => {
    const topicA = a.topics as unknown as { phase: number | null };
    const topicB = b.topics as unknown as { phase: number | null };
    const phaseA = topicA.phase ?? 99;
    const phaseB = topicB.phase ?? 99;
    return phaseA - phaseB;
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // Get known channel IDs to filter out
  const { data: knownChannels } = await db
    .from('channels')
    .select('id');
  const knownChannelIds = new Set(
    (knownChannels ?? []).map((c) => c.id),
  );

  for (const query of sorted) {
    if (isTimedOut()) break;
    if (searchesToday >= DAILY_SEARCH_LIMIT) break;
    if (quotaUsed + SEARCH_QUOTA_COST > softLimit) break;

    try {
      const url = new URL(`${YT_BASE}/search`);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('q', query.query_text);
      url.searchParams.set('type', 'video');
      url.searchParams.set('order', 'date');
      url.searchParams.set('publishedAfter', thirtyDaysAgo);
      url.searchParams.set('maxResults', '10');
      url.searchParams.set('relevanceLanguage', 'en');

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10_000),
      });

      quotaUsed += SEARCH_QUOTA_COST;
      searchesToday++;
      stats.searchesPerformed++;

      if (!res.ok) {
        console.error(`YouTube search error ${res.status} for "${query.query_text}"`);
        continue;
      }

      const data = await res.json();
      const items = data.items ?? [];

      const topic = query.topics as unknown as { id: string };

      for (const item of items) {
        const videoId = item.id?.videoId;
        if (!videoId) continue;

        const channelId = item.snippet?.channelId;
        // Only discover videos from channels we don't already follow
        if (knownChannelIds.has(channelId)) continue;

        // Check if video already exists
        const { data: existing } = await db
          .from('videos')
          .select('id')
          .eq('id', videoId)
          .single();

        if (existing) continue;

        // Insert discovered video
        await db.from('videos').upsert({
          id: videoId,
          workspace_id: '00000000-0000-0000-0000-000000000001',
          channel_id: channelId,
          topic_id: topic.id,
          title: item.snippet?.title ?? '',
          published_at: item.snippet?.publishedAt ?? new Date().toISOString(),
        });
        stats.videosDiscovered++;
      }
    } catch (err) {
      if (err instanceof QuotaSoftLimitReached) break;
      console.error(
        `Search error for "${query.query_text}": ${(err as Error).message}`,
      );
    }
  }

  // Update daily search counter
  await db.from('settings').upsert({
    key: `search_count_${todayStart.toISOString().slice(0, 10)}`,
    value: searchesToday,
  });

  return stats;
}
