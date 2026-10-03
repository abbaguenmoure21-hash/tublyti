import { SupabaseClient } from '@supabase/supabase-js';
import { QuotaSoftLimitReached, getQuotaSoftLimit } from './quota';

/**
 * YouTube search.list — the ONLY file allowed to call search.list.
 * AI_RULES #6: plafonne à 100 appels par jour, journalise chaque appel.
 *
 * v2 changes:
 *   - order=relevance (+ viewCount pass once/week on Sunday)
 *   - maxResults=50 (same quota cost as 10)
 *   - videoDuration=medium then long (no Shorts)
 *   - publishedAfter = 180 days
 *   - regionCode=US, relevanceLanguage=en
 *   - Results go to search_results (no FK to channels — external videos)
 *   - videos.list enrichment (1 unit per 50) for views, duration, subs
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
  videosEnriched: number;
}

export async function runYouTubeSearch(
  db: SupabaseClient,
  deadlineMs: number,
  currentQuotaUsed: number,
): Promise<SearchStats> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { searchesPerformed: 0, videosDiscovered: 0, videosEnriched: 0 };

  const softLimit = getQuotaSoftLimit();
  const isTimedOut = () => Date.now() >= deadlineMs;
  let quotaUsed = currentQuotaUsed;

  const stats: SearchStats = { searchesPerformed: 0, videosDiscovered: 0, videosEnriched: 0 };

  // Check how many searches we've already done today
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayKey = todayStart.toISOString().slice(0, 10);

  const { data: todaySearchSetting } = await db
    .from('settings')
    .select('value')
    .eq('key', `search_count_${todayKey}`)
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

  const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString();

  // viewCount pass on Sundays, relevance the rest of the week
  const dayOfWeek = new Date().getUTCDay();
  const useViewCountOrder = dayOfWeek === 0;

  for (const query of sorted) {
    if (isTimedOut()) break;
    if (searchesToday >= DAILY_SEARCH_LIMIT) break;
    if (quotaUsed + SEARCH_QUOTA_COST > softLimit) break;

    const topic = query.topics as unknown as { id: string };

    // Search for both medium and long durations (no Shorts)
    for (const duration of ['medium', 'long'] as const) {
      if (isTimedOut()) break;
      if (searchesToday >= DAILY_SEARCH_LIMIT) break;
      if (quotaUsed + SEARCH_QUOTA_COST > softLimit) break;

      const order = useViewCountOrder ? 'viewCount' : 'relevance';

      try {
        const url = new URL(`${YT_BASE}/search`);
        url.searchParams.set('key', apiKey);
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('q', query.query_text);
        url.searchParams.set('type', 'video');
        url.searchParams.set('order', order);
        url.searchParams.set('publishedAfter', sixMonthsAgo);
        url.searchParams.set('maxResults', '50');
        url.searchParams.set('videoDuration', duration);
        url.searchParams.set('regionCode', 'US');
        url.searchParams.set('relevanceLanguage', 'en');

        const res = await fetch(url.toString(), {
          signal: AbortSignal.timeout(10_000),
        });

        quotaUsed += SEARCH_QUOTA_COST;
        searchesToday++;
        stats.searchesPerformed++;

        if (!res.ok) {
          console.error(`YouTube search error ${res.status} for "${query.query_text}" (${duration})`);
          continue;
        }

        const data = await res.json();
        const items = data.items ?? [];

        // Collect video IDs for enrichment
        const videoIds: string[] = [];
        const videoMeta = new Map<string, { title: string; channelId: string; publishedAt: string; rank: number }>();

        for (let rank = 0; rank < items.length; rank++) {
          const item = items[rank];
          const videoId = item.id?.videoId;
          if (!videoId) continue;

          videoIds.push(videoId);
          videoMeta.set(videoId, {
            title: item.snippet?.title ?? '',
            channelId: item.snippet?.channelId ?? '',
            publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
            rank: rank + 1,
          });
        }

        if (videoIds.length === 0) continue;

        // Check which videos are already in search_results for this topic
        const { data: existing } = await db
          .from('search_results')
          .select('video_id')
          .eq('topic_id', topic.id)
          .in('video_id', videoIds);
        const existingIds = new Set((existing ?? []).map((r) => r.video_id));
        const newVideoIds = videoIds.filter((id) => !existingIds.has(id));

        if (newVideoIds.length === 0) continue;

        // Enrich with videos.list (1 unit per 50 videos) for views, duration, subs
        let enrichMap = new Map<string, { views: number; durationS: number; channelTitle: string }>();
        if (quotaUsed + 1 <= softLimit) {
          const enrichUrl = new URL(`${YT_BASE}/videos`);
          enrichUrl.searchParams.set('key', apiKey);
          enrichUrl.searchParams.set('part', 'statistics,contentDetails,snippet');
          enrichUrl.searchParams.set('id', newVideoIds.slice(0, 50).join(','));

          const enrichRes = await fetch(enrichUrl.toString(), {
            signal: AbortSignal.timeout(10_000),
          });
          quotaUsed += 1;

          if (enrichRes.ok) {
            const enrichData = await enrichRes.json();
            for (const item of enrichData.items ?? []) {
              const dur = parseDuration(item.contentDetails?.duration ?? '');
              enrichMap.set(item.id, {
                views: parseInt(item.statistics?.viewCount ?? '0', 10),
                durationS: dur,
                channelTitle: item.snippet?.channelTitle ?? '',
              });
            }
            stats.videosEnriched += enrichMap.size;
          }
        }

        // Get channel subscriber counts (batch, 1 unit per 50)
        const channelIds = [...new Set(newVideoIds.map((id) => videoMeta.get(id)?.channelId).filter(Boolean))] as string[];
        const channelSubsMap = new Map<string, number>();

        if (channelIds.length > 0 && quotaUsed + 1 <= softLimit) {
          const chUrl = new URL(`${YT_BASE}/channels`);
          chUrl.searchParams.set('key', apiKey);
          chUrl.searchParams.set('part', 'statistics');
          chUrl.searchParams.set('id', channelIds.slice(0, 50).join(','));

          const chRes = await fetch(chUrl.toString(), { signal: AbortSignal.timeout(10_000) });
          quotaUsed += 1;

          if (chRes.ok) {
            const chData = await chRes.json();
            for (const ch of chData.items ?? []) {
              channelSubsMap.set(ch.id, parseInt(ch.statistics?.subscriberCount ?? '0', 10));
            }
          }
        }

        // Insert into search_results (NOT videos — no FK violation)
        for (const videoId of newVideoIds) {
          const meta = videoMeta.get(videoId);
          if (!meta) continue;
          const enriched = enrichMap.get(videoId);

          const { error } = await db.from('search_results').upsert(
            {
              workspace_id: '00000000-0000-0000-0000-000000000001',
              topic_id: topic.id,
              video_id: videoId,
              channel_id: meta.channelId,
              title: meta.title,
              views: enriched?.views ?? null,
              duration_s: enriched?.durationS ?? null,
              published_at: meta.publishedAt,
              channel_title: enriched?.channelTitle ?? null,
              channel_subscribers: channelSubsMap.get(meta.channelId) ?? null,
              rank: meta.rank,
              searched_at: new Date().toISOString(),
            },
            { onConflict: 'topic_id,video_id' },
          );
          if (error) {
            console.error(`search_results upsert error for ${videoId}: ${error.message}`);
          } else {
            stats.videosDiscovered++;
          }
        }
      } catch (err) {
        if (err instanceof QuotaSoftLimitReached) break;
        console.error(
          `Search error for "${query.query_text}" (${duration}): ${(err as Error).message}`,
        );
      }
    }
  }

  // Update daily search counter
  await db.from('settings').upsert({
    key: `search_count_${todayKey}`,
    value: searchesToday,
  });

  return stats;
}

/**
 * Perform a single YouTube search.list call and return raw results.
 * This is the ONLY file allowed to call search.list.
 * Cost: 100 quota units per call.
 */
export async function searchSingle(
  query: string,
  options: {
    publishedAfter: string;
    videoDuration: 'medium' | 'long';
    maxResults?: number;
  },
): Promise<{ results: SearchResult[]; quotaUsed: number }> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { results: [], quotaUsed: 0 };

  const url = new URL(`${YT_BASE}/search`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('publishedAfter', options.publishedAfter);
  url.searchParams.set('maxResults', String(options.maxResults ?? 50));
  url.searchParams.set('videoDuration', options.videoDuration);
  url.searchParams.set('regionCode', 'US');
  url.searchParams.set('relevanceLanguage', 'en');

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`YouTube search ${res.status} for "${query}"`);

  const data = await res.json();
  const results: SearchResult[] = [];
  for (const item of data.items ?? []) {
    const videoId = item.id?.videoId;
    if (!videoId) continue;
    results.push({
      videoId,
      title: item.snippet?.title ?? '',
      channelId: item.snippet?.channelId ?? '',
      publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
    });
  }

  return { results, quotaUsed: SEARCH_QUOTA_COST };
}

/** Parse ISO 8601 duration (PT#H#M#S) to seconds */
function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] ?? '0', 10) * 3600)
    + (parseInt(match[2] ?? '0', 10) * 60)
    + parseInt(match[3] ?? '0', 10);
}
