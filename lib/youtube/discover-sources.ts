/**
 * Channel discovery sources:
 * - channelSections.list: recommended channels by followed channels
 * - trending (mostPopular): low-cost scan of trending videos by category
 * - search results: zero-quota extraction from existing search_results table
 * - (manual/vidIQ import: handled by seed.ts)
 *
 * All discovered channels go to candidate_channels for triage.
 */
import { SupabaseClient } from '@supabase/supabase-js';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

export interface DiscoverySourceResult {
  channelsDiscovered: number;
  quotaUsed: number;
  source: string;
}

async function ytFetch(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not set');

  const url = new URL(`${YT_BASE}/${endpoint}`);
  url.searchParams.set('key', apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`YouTube API ${endpoint} ${res.status}`);
  return res.json();
}

/**
 * Discover channels recommended by followed channels via channelSections.list.
 * Cost: 1 quota unit per channel checked.
 */
export async function discoverFromChannelSections(
  db: SupabaseClient,
  deadlineMs: number,
  quotaBudget: number,
): Promise<DiscoverySourceResult> {
  const result: DiscoverySourceResult = { channelsDiscovered: 0, quotaUsed: 0, source: 'channel_section' };
  const isTimedOut = () => Date.now() >= deadlineMs;

  // Get followed channels, prioritize those not yet scanned for sections
  const { data: channels } = await db
    .from('channels')
    .select('id, niche_id')
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(50);

  if (!channels?.length) return result;

  // Get known channel IDs
  const [{ data: followed }, { data: candidates }] = await Promise.all([
    db.from('channels').select('id'),
    db.from('candidate_channels').select('id'),
  ]);
  const knownIds = new Set([
    ...(followed ?? []).map((c) => c.id),
    ...(candidates ?? []).map((c) => c.id),
  ]);

  for (const channel of channels) {
    if (isTimedOut()) break;
    if (result.quotaUsed >= quotaBudget) break;

    try {
      const data = await ytFetch('channelSections', {
        part: 'contentDetails',
        channelId: channel.id,
      }) as { items?: Array<{ contentDetails?: { channels?: string[] } }> };
      result.quotaUsed += 1;

      for (const section of data.items ?? []) {
        const sectionChannels = section.contentDetails?.channels ?? [];
        for (const channelId of sectionChannels) {
          if (knownIds.has(channelId)) continue;
          knownIds.add(channelId);

          const { error } = await db.from('candidate_channels').upsert({
            id: channelId,
            discovered_via: 'channel_section',
            niche_id: channel.niche_id,
            status: 'pending',
          }, { onConflict: 'id' });
          if (error) {
            console.error(`candidate_channels upsert error: ${error.message}`);
          } else {
            result.channelsDiscovered++;
          }
        }
      }
    } catch {
      // Skip on error
    }
  }

  return result;
}

/**
 * Discover channels from search_results that are not yet followed or candidates.
 * Zero quota — reads from existing search_results table.
 */
export async function discoverFromSearchResults(
  db: SupabaseClient,
): Promise<DiscoverySourceResult> {
  const result: DiscoverySourceResult = { channelsDiscovered: 0, quotaUsed: 0, source: 'search' };

  // Get known channel IDs
  const [{ data: followed }, { data: candidates }] = await Promise.all([
    db.from('channels').select('id'),
    db.from('candidate_channels').select('id'),
  ]);
  const knownIds = new Set([
    ...(followed ?? []).map((c) => c.id),
    ...(candidates ?? []).map((c) => c.id),
  ]);

  // Get distinct channel IDs from search_results with decent metrics
  const { data: searchChannels } = await db
    .from('search_results')
    .select('channel_id, channel_title, channel_subscribers, topic_id, topics!inner(niche_id)')
    .gte('channel_subscribers', 3000)
    .order('channel_subscribers', { ascending: false })
    .limit(200);

  const seen = new Set<string>();
  for (const row of searchChannels ?? []) {
    if (knownIds.has(row.channel_id)) continue;
    if (seen.has(row.channel_id)) continue;
    seen.add(row.channel_id);

    const nicheId = (row.topics as unknown as { niche_id: string })?.niche_id;

    const { error } = await db.from('candidate_channels').upsert({
      id: row.channel_id,
      title: row.channel_title,
      subscriber_count: row.channel_subscribers,
      discovered_via: 'search',
      niche_id: nicheId ?? null,
      status: 'pending',
    }, { onConflict: 'id' });
    if (error) {
      console.error(`candidate_channels upsert error: ${error.message}`);
    } else {
      result.channelsDiscovered++;
    }
  }

  return result;
}

// YouTube categories relevant to our niches
const TRENDING_CATEGORIES = [
  '27', // Education (finance, psychology)
  '28', // Science & Technology (AI tools)
  '22', // People & Blogs (faceless content)
];

/**
 * Discover channels from trending videos by category.
 * Cost: 1 quota unit per category scanned.
 */
export async function discoverFromTrending(
  db: SupabaseClient,
  quotaBudget: number,
): Promise<DiscoverySourceResult> {
  const result: DiscoverySourceResult = { channelsDiscovered: 0, quotaUsed: 0, source: 'trending' };

  if (!process.env.YOUTUBE_API_KEY) return result;

  // Get known channel IDs
  const [{ data: followed }, { data: candidates }] = await Promise.all([
    db.from('channels').select('id'),
    db.from('candidate_channels').select('id'),
  ]);
  const knownIds = new Set([
    ...(followed ?? []).map((c) => c.id),
    ...(candidates ?? []).map((c) => c.id),
  ]);

  for (const categoryId of TRENDING_CATEGORIES) {
    if (result.quotaUsed >= quotaBudget) break;

    try {
      const data = await ytFetch('videos', {
        part: 'snippet',
        chart: 'mostPopular',
        regionCode: 'US',
        videoCategoryId: categoryId,
        maxResults: '50',
      }) as { items?: Array<{ snippet?: { channelId?: string; channelTitle?: string } }> };
      result.quotaUsed += 1;

      const seen = new Set<string>();
      for (const item of data.items ?? []) {
        const channelId = item.snippet?.channelId;
        if (!channelId || knownIds.has(channelId) || seen.has(channelId)) continue;
        seen.add(channelId);
        knownIds.add(channelId);

        const { error } = await db.from('candidate_channels').upsert({
          id: channelId,
          title: item.snippet?.channelTitle ?? channelId,
          discovered_via: 'trending',
          status: 'pending',
        }, { onConflict: 'id' });
        if (!error) result.channelsDiscovered++;
      }
    } catch {
      // Skip on error
    }
  }

  return result;
}

/**
 * Run all discovery sources within their quota budget.
 */
export async function runDiscoverySources(
  db: SupabaseClient,
  deadlineMs: number,
  discoveryBudget: number,
): Promise<{
  channelSections: DiscoverySourceResult;
  trending: DiscoverySourceResult;
  searchResults: DiscoverySourceResult;
}> {
  const channelSections = await discoverFromChannelSections(db, deadlineMs, discoveryBudget);
  const trendingBudget = Math.max(0, discoveryBudget - channelSections.quotaUsed);
  const trending = await discoverFromTrending(db, trendingBudget);
  const searchResults = await discoverFromSearchResults(db);

  return { channelSections, trending, searchResults };
}
