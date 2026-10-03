/**
 * Update subscriber counts for user_channels that have a YouTube channel ID.
 * - UC… IDs: fetch via channels.list (batches of 50, 1 quota unit/batch)
 * - @handle: resolve once via channels.list?forHandle= then replace with UC… ID
 *
 * Runs nightly after collect, before scoring.
 */
import { SupabaseClient } from '@supabase/supabase-js';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

export interface UpdateUserChannelsResult {
  updated: number;
  resolved: number;
  quotaUsed: number;
}

async function ytFetch(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not set');
  const url = new URL(`${YT_BASE}/${endpoint}`);
  url.searchParams.set('key', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`YouTube API ${endpoint} ${res.status}`);
  return res.json();
}

export async function updateUserChannelSubs(
  db: SupabaseClient,
): Promise<UpdateUserChannelsResult> {
  const result: UpdateUserChannelsResult = { updated: 0, resolved: 0, quotaUsed: 0 };

  // Get all user_channels with a youtube_channel_id
  const { data: userChannels } = await db
    .from('user_channels')
    .select('id, youtube_channel_id')
    .not('youtube_channel_id', 'is', null);

  if (!userChannels?.length) return result;

  // Separate handles (@...) from UC… IDs
  const handles: { rowId: string; handle: string }[] = [];
  const ucIds: { rowId: string; ucId: string }[] = [];

  for (const uc of userChannels) {
    const ytId = (uc.youtube_channel_id as string).trim();
    if (!ytId) continue;

    if (ytId.startsWith('@')) {
      handles.push({ rowId: uc.id, handle: ytId.slice(1) });
    } else if (ytId.startsWith('UC')) {
      ucIds.push({ rowId: uc.id, ucId: ytId });
    }
    // Ignore other formats
  }

  // Resolve @handles to UC… IDs (1 quota unit each)
  for (const h of handles) {
    try {
      const data = await ytFetch('channels', {
        part: 'snippet,statistics',
        forHandle: h.handle,
      }) as { items?: Array<{ id: string; statistics?: { subscriberCount?: string } }> };
      result.quotaUsed += 1;

      const ch = data.items?.[0];
      if (ch) {
        const subs = parseInt(ch.statistics?.subscriberCount ?? '0', 10);
        // Replace handle with UC… ID and store subscriber count
        await db.from('user_channels').update({
          youtube_channel_id: ch.id,
          subscriber_count: subs,
          subscribers_checked_at: new Date().toISOString(),
        }).eq('id', h.rowId);
        result.resolved++;
        result.updated++;
      }
    } catch {
      // Skip on error
    }
  }

  // Batch update UC… IDs (50 per batch, 1 quota unit per batch)
  for (let i = 0; i < ucIds.length; i += 50) {
    const batch = ucIds.slice(i, i + 50);
    const ids = batch.map((b) => b.ucId).join(',');

    try {
      const data = await ytFetch('channels', {
        part: 'statistics',
        id: ids,
      }) as { items?: Array<{ id: string; statistics?: { subscriberCount?: string } }> };
      result.quotaUsed += 1;

      const subsById = new Map<string, number>();
      for (const ch of data.items ?? []) {
        subsById.set(ch.id, parseInt(ch.statistics?.subscriberCount ?? '0', 10));
      }

      for (const b of batch) {
        const subs = subsById.get(b.ucId);
        if (subs !== undefined) {
          await db.from('user_channels').update({
            subscriber_count: subs,
            subscribers_checked_at: new Date().toISOString(),
          }).eq('id', b.rowId);
          result.updated++;
        }
      }
    } catch {
      // Skip batch on error
    }
  }

  return result;
}
