/**
 * Additional channel discovery sources beyond search.list:
 * - channelSections.list: recommended channels by followed channels
 * - trending videos: mostPopular by category
 * - comment authors: active channel owners commenting on niche videos
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
    .select('id')
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

          await db.from('candidate_channels').upsert({
            id: channelId,
            discovered_via: 'channel_section',
            status: 'pending',
          }, { onConflict: 'id' });
          result.channelsDiscovered++;
        }
      }
    } catch {
      // Skip on error
    }
  }

  return result;
}

/**
 * Discover channels from trending/mostPopular videos by category.
 * Categories: Education (27), Science & Technology (28), News & Politics (25), Entertainment (24)
 * Countries: US, GB, CA, AU
 * Cost: 1 quota unit per category×country combination.
 */
export async function discoverFromTrending(
  db: SupabaseClient,
  deadlineMs: number,
  quotaBudget: number,
): Promise<DiscoverySourceResult> {
  const result: DiscoverySourceResult = { channelsDiscovered: 0, quotaUsed: 0, source: 'trending' };
  const isTimedOut = () => Date.now() >= deadlineMs;

  const categories = ['27', '28', '25', '24']; // Education, Sci&Tech, News, Entertainment
  const countries = ['US', 'GB', 'CA', 'AU'];

  // Get known channel IDs
  const [{ data: followed }, { data: candidates }] = await Promise.all([
    db.from('channels').select('id'),
    db.from('candidate_channels').select('id'),
  ]);
  const knownIds = new Set([
    ...(followed ?? []).map((c) => c.id),
    ...(candidates ?? []).map((c) => c.id),
  ]);

  for (const category of categories) {
    for (const country of countries) {
      if (isTimedOut()) return result;
      if (result.quotaUsed >= quotaBudget) return result;

      try {
        const data = await ytFetch('videos', {
          part: 'snippet',
          chart: 'mostPopular',
          videoCategoryId: category,
          regionCode: country,
          maxResults: '50',
        }) as { items?: Array<{ snippet?: { channelId?: string } }> };
        result.quotaUsed += 1;

        for (const item of data.items ?? []) {
          const channelId = item.snippet?.channelId;
          if (!channelId || knownIds.has(channelId)) continue;
          knownIds.add(channelId);

          await db.from('candidate_channels').upsert({
            id: channelId,
            discovered_via: 'trending',
            status: 'pending',
          }, { onConflict: 'id' });
          result.channelsDiscovered++;
        }
      } catch {
        // Skip on error
      }
    }
  }

  return result;
}

/**
 * Discover channels from comment authors on niche videos.
 * Samples top commenters on phase 0/1/2 videos and checks if they run active channels.
 * Cost: 0 extra quota (comment data already collected), but needs channels.list to verify (1 per 50).
 */
export async function discoverFromCommentAuthors(
  db: SupabaseClient,
  deadlineMs: number,
  quotaBudget: number,
): Promise<DiscoverySourceResult> {
  const result: DiscoverySourceResult = { channelsDiscovered: 0, quotaUsed: 0, source: 'comment_author' };
  const isTimedOut = () => Date.now() >= deadlineMs;

  // Get distinct channel IDs from comments that have high engagement
  // YouTube comment IDs contain the channel ID of the commenter
  // Format: Ug... (legacy) or channelId.commentId
  // We can extract author channel IDs from the comment API data if stored,
  // but since we only store comment text/id, we skip this source for now
  // until we add author_channel_id to the comments table.

  // For now, this is a placeholder that will be activated when
  // comments table includes author_channel_id column.
  void db;
  void deadlineMs;
  void quotaBudget;
  void isTimedOut;

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
  commentAuthors: DiscoverySourceResult;
}> {
  // Split budget: 40% channel sections, 40% trending, 20% comment authors
  const sectionBudget = Math.floor(discoveryBudget * 0.4);
  const trendingBudget = Math.floor(discoveryBudget * 0.4);
  const commentBudget = Math.floor(discoveryBudget * 0.2);

  const channelSections = await discoverFromChannelSections(db, deadlineMs, sectionBudget);
  const trending = await discoverFromTrending(db, deadlineMs, trendingBudget);
  const commentAuthors = await discoverFromCommentAuthors(db, deadlineMs, commentBudget);

  return { channelSections, trending, commentAuthors };
}
