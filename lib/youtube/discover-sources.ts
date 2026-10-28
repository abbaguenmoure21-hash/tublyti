/**
 * Channel discovery sources:
 * - channelSections.list: recommended channels by followed channels
 * - (trending removed: too noisy, no niche affinity)
 * - search results: zero-quota extraction from existing search_results table
 * - (manual/vidIQ import: handled by seed.ts)
 *
 * All discovered channels go to candidate_channels for triage.
 * Existing candidates (rejected / accepted / pending) are never overwritten (ignoreDuplicates).
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { QuotaSoftLimitReached } from './quota';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const RESCAN_DAYS = 30;

export interface DiscoverySourceResult {
  channelsDiscovered: number;
  quotaUsed: number;
  source: string;
  errors?: number;
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
  if (!res.ok) throw new Error(`YouTube API ${endpoint} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}

/** Ids among `ids` already followed or already candidates (checked per batch: no global 1 000-row list). */
async function knownAmong(db: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const [followed, candidates] = await Promise.all([
      db.from('channels').select('id').in('id', chunk),
      db.from('candidate_channels').select('id').in('id', chunk),
    ]);
    if (followed.error) throw new Error(`discover-sources: read channels: ${followed.error.message}`);
    if (candidates.error) throw new Error(`discover-sources: read candidates: ${candidates.error.message}`);
    for (const r of [...(followed.data ?? []), ...(candidates.data ?? [])]) known.add((r as { id: string }).id);
  }
  return known;
}

/**
 * Discover channels recommended by followed channels via channelSections.list.
 * Cost: 1 quota unit per channel checked. Channels never scanned first, then those scanned > 30 days ago
 * (channels.sections_scanned_at, migration 00033; falls back to last_checked_at order without it).
 */
export async function discoverFromChannelSections(
  db: SupabaseClient,
  deadlineMs: number,
  quotaBudget: number,
): Promise<DiscoverySourceResult> {
  const result: DiscoverySourceResult = { channelsDiscovered: 0, quotaUsed: 0, source: 'channel_section', errors: 0 };
  const isTimedOut = () => Date.now() >= deadlineMs;
  const rescanBefore = new Date(Date.now() - RESCAN_DAYS * 86_400_000).toISOString();

  let hasScanCol = true;
  let { data: channels, error } = await db
    .from('channels')
    .select('id, niche_id')
    .or(`sections_scanned_at.is.null,sections_scanned_at.lt.${rescanBefore}`)
    .order('sections_scanned_at', { ascending: true, nullsFirst: true })
    .limit(50);
  if (error && /sections_scanned_at/.test(error.message)) {
    console.warn('  [discover-sources] channels.sections_scanned_at absent (migration 00033) — same 50 channels as before');
    hasScanCol = false;
    ({ data: channels, error } = await db
      .from('channels')
      .select('id, niche_id')
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .limit(50));
  }
  if (error) throw new Error(`discover-sources: read channels: ${error.message}`);
  if (!channels?.length) return result;

  let attempted = 0;
  for (const channel of channels) {
    if (isTimedOut()) break;
    if (result.quotaUsed >= quotaBudget) break;

    attempted++;
    try {
      const data = await ytFetch('channelSections', {
        part: 'contentDetails',
        channelId: channel.id,
      }) as { items?: Array<{ contentDetails?: { channels?: string[] } }> };
      result.quotaUsed += 1;

      const sectionChannels = [...new Set((data.items ?? []).flatMap((s) => s.contentDetails?.channels ?? []))];
      const known = sectionChannels.length ? await knownAmong(db, sectionChannels) : new Set<string>();
      const fresh = sectionChannels.filter((id) => !known.has(id));
      if (fresh.length) {
        const { error: upErr, data: inserted } = await db.from('candidate_channels').upsert(
          fresh.map((id) => ({ id, discovered_via: 'channel_section', niche_id: channel.niche_id, status: 'pending' })),
          { onConflict: 'id', ignoreDuplicates: true },
        ).select('id');
        if (upErr) console.error(`candidate_channels upsert error: ${upErr.message}`);
        else result.channelsDiscovered += inserted?.length ?? fresh.length;
      }
      if (hasScanCol) {
        await db.from('channels').update({ sections_scanned_at: new Date().toISOString() }).eq('id', channel.id);
      }
    } catch (err) {
      if (err instanceof QuotaSoftLimitReached) throw err;
      result.errors = (result.errors ?? 0) + 1;
      console.error(`  [discover-sources] ${channel.id}: ${(err as Error).message}`);
    }
  }

  if (attempted > 0 && result.errors === attempted) {
    throw new Error(`discover-sources: all ${attempted} channelSections requests failed`);
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

  // Get distinct channel IDs from search_results with decent metrics
  const { data: searchChannels, error } = await db
    .from('search_results')
    .select('channel_id, channel_title, channel_subscribers, topic_id, topics!inner(niche_id)')
    .gte('channel_subscribers', 3000)
    .order('channel_subscribers', { ascending: false })
    .limit(200);
  if (error) throw new Error(`discover-sources: read search_results: ${error.message}`);

  const known = await knownAmong(db, [...new Set((searchChannels ?? []).map((r) => r.channel_id as string))]);
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const row of searchChannels ?? []) {
    if (known.has(row.channel_id)) continue;
    if (seen.has(row.channel_id)) continue;
    seen.add(row.channel_id);

    const nicheId = (row.topics as unknown as { niche_id: string })?.niche_id;
    rows.push({
      id: row.channel_id,
      title: row.channel_title,
      subscriber_count: row.channel_subscribers,
      discovered_via: 'search',
      niche_id: nicheId ?? null,
      status: 'pending',
    });
  }

  if (rows.length) {
    const { error: upErr, data: inserted } = await db
      .from('candidate_channels')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      .select('id');
    if (upErr) console.error(`candidate_channels upsert error: ${upErr.message}`);
    else result.channelsDiscovered = inserted?.length ?? rows.length;
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
  searchResults: DiscoverySourceResult;
}> {
  const channelSections = await discoverFromChannelSections(db, deadlineMs, discoveryBudget);
  const searchResults = await discoverFromSearchResults(db);

  return { channelSections, searchResults };
}
