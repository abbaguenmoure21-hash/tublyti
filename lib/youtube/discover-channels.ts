import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { reserveAiBudget, settleAiBudget } from '../ai/budget';
import { getQuotaSoftLimit } from './quota';
import { HAIKU_45_BATCH, costUsd } from '../ai/pricing';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const SEARCH_QUOTA_COST = 100;
const WEEKLY_DISCOVERY_LIMIT = 30;
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Batch API pricing (50% off standard Haiku 4.5)
const EST_INPUT_TOKENS = 400;
const EST_OUTPUT_TOKENS = 80;

export interface DiscoverResult {
  searchesPerformed: number;
  channelsDiscovered: number;
  facelessEstimated: number;
  estimatedCostUSD: number;
  stoppedByQuota: boolean;
  stoppedByTimeout: boolean;
}

const FACELESS_PROMPT = `Tu analyses une chaîne YouTube pour estimer si c'est une chaîne "faceless" (sans visage humain récurrent).

Indices d'une chaîne faceless :
- Pas de personne identifiable dans le titre ou la description de la chaîne
- Titres de vidéos génériques (pas de "je", "my", prénom)
- Thèmes compilation, top N, explications avec voix off, musique de fond
- Noms de chaîne abstraits ou descriptifs plutôt qu'un nom de personne

Indices d'une chaîne NON faceless :
- Nom de personne dans le titre de la chaîne
- Titres de vidéos à la première personne
- Description mentionnant "je suis", "I'm", un parcours personnel
- Vlogs, interviews face caméra

Réponds en JSON strict avec :
- \`probability\` : nombre entre 0.0 et 1.0 (probabilité que ce soit faceless)
- \`reason\` : une phrase courte en français expliquant ton estimation

Réponds UNIQUEMENT avec le JSON, sans texte autour.`;

function estimateCost(count: number): number {
  return costUsd(HAIKU_45_BATCH, count * EST_INPUT_TOKENS, count * EST_OUTPUT_TOKENS);
}

function weekKey(): string {
  const d = new Date();
  // ISO week start
  const dayOfWeek = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((dayOfWeek + 6) % 7));
  return `discovery_count_${monday.toISOString().slice(0, 10)}`;
}

/**
 * Discover new channels by searching YouTube for phase 1/2 topic queries.
 * Max 30 searches per week for this task.
 */
export async function discoverChannels(
  db: SupabaseClient,
  deadlineMs: number,
  currentQuotaUsed: number,
): Promise<DiscoverResult> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return emptyResult();

  const softLimit = getQuotaSoftLimit();
  const isTimedOut = () => Date.now() >= deadlineMs;
  let quotaUsed = currentQuotaUsed;

  // Enforce per-task discovery budget from quota_plan
  const { data: planSetting } = await db.from('settings').select('value').eq('key', 'quota_plan').single();
  const discoveryBudget = (planSetting?.value as Record<string, number>)?.discovery ?? 3000;
  let discoveryQuotaUsed = 0;

  const result: DiscoverResult = {
    searchesPerformed: 0,
    channelsDiscovered: 0,
    facelessEstimated: 0,
    estimatedCostUSD: 0,
    stoppedByQuota: false,
    stoppedByTimeout: false,
  };

  // Check weekly discovery limit
  const wk = weekKey();
  const { data: weekSetting } = await db
    .from('settings')
    .select('value')
    .eq('key', wk)
    .single();
  let discoveriesThisWeek = typeof weekSetting?.value === 'number' ? weekSetting.value : 0;

  if (discoveriesThisWeek >= WEEKLY_DISCOVERY_LIMIT) return result;

  // Load topic queries for phase 1 and 2 topics
  const { data: queries } = await db
    .from('topic_queries')
    .select(`
      id, query_text, source,
      topics!inner(id, label, phase, status)
    `)
    .eq('source', 'youtube')
    .in('topics.status', ['active', 'in_production'])
    .order('priority', { ascending: true });

  if (!queries?.length) return result;

  // Filter to only phase 1 and 2 topics
  const phase12Queries = queries.filter((q) => {
    const topic = q.topics as unknown as { phase: number | null };
    return topic.phase === 1 || topic.phase === 2;
  });

  if (phase12Queries.length === 0) return result;

  // Get known channel IDs (both followed and candidates)
  const [{ data: followedChannels }, { data: candidateChannels }] = await Promise.all([
    db.from('channels').select('id'),
    db.from('candidate_channels').select('id'),
  ]);
  const knownIds = new Set([
    ...(followedChannels ?? []).map((c) => c.id),
    ...(candidateChannels ?? []).map((c) => c.id),
  ]);

  // Discovered channel IDs in this run (to batch-process)
  const discoveredChannelIds = new Map<string, string>(); // channelId -> source topic id

  for (const query of phase12Queries) {
    if (isTimedOut()) { result.stoppedByTimeout = true; break; }
    if (discoveriesThisWeek >= WEEKLY_DISCOVERY_LIMIT) break;
    if (quotaUsed + SEARCH_QUOTA_COST > softLimit) { result.stoppedByQuota = true; break; }
    if (discoveryQuotaUsed + SEARCH_QUOTA_COST > discoveryBudget) { result.stoppedByQuota = true; break; }

    try {
      const url = new URL(`${YT_BASE}/search`);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('q', query.query_text);
      url.searchParams.set('type', 'video');
      url.searchParams.set('order', 'relevance');
      url.searchParams.set('maxResults', '15');
      url.searchParams.set('relevanceLanguage', 'en');

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10_000),
      });

      quotaUsed += SEARCH_QUOTA_COST;
      discoveryQuotaUsed += SEARCH_QUOTA_COST;
      discoveriesThisWeek++;
      result.searchesPerformed++;

      if (!res.ok) {
        console.error(`Discovery search error ${res.status} for "${query.query_text}"`);
        continue;
      }

      const data = await res.json();
      const topic = query.topics as unknown as { id: string };

      for (const item of data.items ?? []) {
        const channelId = item.snippet?.channelId;
        if (!channelId) continue;
        if (knownIds.has(channelId)) continue;
        if (discoveredChannelIds.has(channelId)) continue;

        discoveredChannelIds.set(channelId, topic.id);
        knownIds.add(channelId); // prevent duplicates within this run
      }
    } catch (err) {
      console.error(`Discovery search error for "${query.query_text}": ${(err as Error).message}`);
    }
  }

  // Update weekly counter
  await db.from('settings').upsert({ key: wk, value: discoveriesThisWeek });

  if (discoveredChannelIds.size === 0) return result;

  // Fetch channel details in batches of 50
  const channelEntries = [...discoveredChannelIds.entries()];
  const channelInfos: {
    id: string;
    title: string;
    description: string;
    subscriberCount: number;
    videoCount: number;
    uploadsPlaylistId: string;
    sourceTopicId: string;
  }[] = [];

  for (let i = 0; i < channelEntries.length; i += 50) {
    if (isTimedOut()) { result.stoppedByTimeout = true; break; }
    if (quotaUsed + 1 > softLimit || discoveryQuotaUsed + 1 > discoveryBudget) { result.stoppedByQuota = true; break; }

    const batch = channelEntries.slice(i, i + 50);
    const ids = batch.map(([id]) => id);

    const url = new URL(`${YT_BASE}/channels`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('part', 'snippet,statistics,contentDetails');
    url.searchParams.set('id', ids.join(','));
    url.searchParams.set('maxResults', '50');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    quotaUsed += 1;
    discoveryQuotaUsed += 1;

    if (!res.ok) continue;

    const data = await res.json();
    for (const item of data.items ?? []) {
      const sourceTopicId = discoveredChannelIds.get(item.id) ?? '';
      channelInfos.push({
        id: item.id,
        title: item.snippet?.title ?? item.id,
        description: item.snippet?.description ?? '',
        subscriberCount: parseInt(item.statistics?.subscriberCount ?? '0', 10),
        videoCount: parseInt(item.statistics?.videoCount ?? '0', 10),
        uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? '',
        sourceTopicId,
      });
    }
  }

  if (channelInfos.length === 0) return result;

  // Fetch last 10 video titles per channel for median views + faceless estimation
  // Use uploads playlist (1 quota unit per channel)
  const channelVideoData: Map<string, { titles: string[]; medianViews: number; videosPerMonth: number; longVideoCount: number }> = new Map();

  for (const ch of channelInfos) {
    if (isTimedOut()) { result.stoppedByTimeout = true; break; }
    if (!ch.uploadsPlaylistId) continue;
    if (quotaUsed + 2 > softLimit || discoveryQuotaUsed + 2 > discoveryBudget) { result.stoppedByQuota = true; break; }

    // Get last 10 video IDs from uploads playlist
    const plUrl = new URL(`${YT_BASE}/playlistItems`);
    plUrl.searchParams.set('key', apiKey);
    plUrl.searchParams.set('part', 'contentDetails');
    plUrl.searchParams.set('playlistId', ch.uploadsPlaylistId);
    plUrl.searchParams.set('maxResults', '10');

    const plRes = await fetch(plUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    quotaUsed += 1;
    discoveryQuotaUsed += 1;

    if (!plRes.ok) continue;
    const plData = await plRes.json();
    const videoIds = (plData.items ?? [])
      .map((item: { contentDetails?: { videoId?: string } }) => item.contentDetails?.videoId)
      .filter((id: string | undefined): id is string => !!id);

    if (videoIds.length === 0) continue;

    // Get video statistics + duration
    const vUrl = new URL(`${YT_BASE}/videos`);
    vUrl.searchParams.set('key', apiKey);
    vUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
    vUrl.searchParams.set('id', videoIds.join(','));

    const vRes = await fetch(vUrl.toString(), { signal: AbortSignal.timeout(10_000) });
    quotaUsed += 1;
    discoveryQuotaUsed += 1;

    if (!vRes.ok) continue;
    const vData = await vRes.json();

    const titles: string[] = [];
    const views: number[] = [];
    let oldestDate: Date | null = null;
    let newestDate: Date | null = null;
    let longVideoCount = 0;
    const now = Date.now();
    const ninetyDaysAgo = now - 90 * 86_400_000;

    for (const v of vData.items ?? []) {
      titles.push(v.snippet?.title ?? '');
      views.push(parseInt(v.statistics?.viewCount ?? '0', 10));
      const pubDate = new Date(v.snippet?.publishedAt ?? Date.now());
      if (!oldestDate || pubDate < oldestDate) oldestDate = pubDate;
      if (!newestDate || pubDate > newestDate) newestDate = pubDate;

      // Count long videos (≥8min) published in last 90 days
      const duration = v.contentDetails?.duration ?? '';
      const seconds = parseISO8601Duration(duration);
      if (seconds >= 480 && pubDate.getTime() >= ninetyDaysAgo) {
        longVideoCount++;
      }
    }

    // Compute median views
    const sorted = [...views].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianViews = sorted.length % 2 === 0
      ? Math.floor((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];

    // Compute videos per month
    let videosPerMonth = 0;
    if (oldestDate && newestDate && newestDate > oldestDate) {
      const monthsDiff = (newestDate.getTime() - oldestDate.getTime()) / (30 * 86_400_000);
      videosPerMonth = monthsDiff > 0 ? Math.round((views.length / monthsDiff) * 10) / 10 : views.length;
    }

    channelVideoData.set(ch.id, { titles, medianViews, videosPerMonth, longVideoCount });
  }

  // Estimate faceless probability via Claude Haiku (Batch API)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && channelInfos.length > 0) {
    const cost = estimateCost(channelInfos.length);
    // Atomic reservation of the batch estimate (kept as the spend, like before).
    const reservation = await reserveAiBudget(db, cost);

    if (reservation.ok) {
      let submitted = false;
      try {
        const anthropic = new Anthropic();
        const systemPrompt = FACELESS_PROMPT;

        const requests = channelInfos.map((ch) => {
          const videoData = channelVideoData.get(ch.id);
          const videoTitles = videoData?.titles.slice(0, 5).join('\n') ?? '';

          return {
            custom_id: ch.id,
            params: {
              model: HAIKU_MODEL,
              max_tokens: 256 as const,
              system: systemPrompt,
              messages: [{
                role: 'user' as const,
                content: `Chaîne : ${ch.title}\nDescription : ${ch.description.slice(0, 300)}\n\n5 titres de vidéos récentes :\n${videoTitles}`,
              }],
            },
          };
        });

        const batch = await anthropic.messages.batches.create({ requests });
        submitted = true;

        // Store batch ID for retrieval
        const { data: pendingSetting } = await db
          .from('settings')
          .select('value')
          .eq('key', 'pending_discovery_batches')
          .single();
        const pending: string[] = (pendingSetting?.value as string[]) ?? [];
        pending.push(batch.id);
        await db.from('settings').upsert({ key: 'pending_discovery_batches', value: pending });

        result.estimatedCostUSD = cost;
        result.facelessEstimated = channelInfos.length;
      } catch (err) {
        if (!submitted) await settleAiBudget(db, reservation, 0).catch(() => undefined);
        console.error(`Faceless batch error: ${(err as Error).message}`);
      }
    }
  }

  // Insert candidate channels (without faceless probability — that comes from batch results)
  for (const ch of channelInfos) {
    const videoData = channelVideoData.get(ch.id);

    await db.from('candidate_channels').upsert({
      id: ch.id,
      title: ch.title,
      subscriber_count: ch.subscriberCount,
      median_views: videoData?.medianViews ?? null,
      videos_per_month: videoData?.videosPerMonth ?? null,
      long_video_count: videoData?.longVideoCount ?? null,
      discovered_via: 'search',
      source_topic_id: ch.sourceTopicId,
      status: 'pending',
    }, { onConflict: 'id' });

    result.channelsDiscovered++;
  }

  return result;
}

/**
 * Retrieve pending faceless estimation batch results and update candidate_channels.
 */
export async function retrieveDiscoveryBatches(
  db: SupabaseClient,
): Promise<number> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return 0;

  const { data: pendingSetting } = await db
    .from('settings')
    .select('value')
    .eq('key', 'pending_discovery_batches')
    .single();

  const pendingBatches: string[] = (pendingSetting?.value as string[]) ?? [];
  if (pendingBatches.length === 0) return 0;

  const anthropic = new Anthropic();
  const stillPending: string[] = [];
  let updated = 0;

  for (const batchId of pendingBatches) {
    try {
      const batch = await anthropic.messages.batches.retrieve(batchId);

      if (batch.processing_status === 'ended') {
        const resultsStream = await anthropic.messages.batches.results(batchId);

        for await (const item of resultsStream) {
          if (item.result.type === 'succeeded') {
            const content = item.result.message.content[0];
            if (content.type === 'text') {
              try {
                let jsonText = content.text.trim();
                const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (fenceMatch) jsonText = fenceMatch[1].trim();

                const parsed = JSON.parse(jsonText);
                const probability = typeof parsed.probability === 'number'
                  ? Math.min(1, Math.max(0, parsed.probability))
                  : null;
                const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : null;

                if (probability !== null) {
                  await db.from('candidate_channels').update({
                    faceless_probability: probability,
                    faceless_reason: reason,
                  }).eq('id', item.custom_id);
                  updated++;
                }
              } catch {
                // Malformed JSON — skip
              }
            }
          }
        }
      } else {
        stillPending.push(batchId);
      }
    } catch {
      stillPending.push(batchId);
    }
  }

  await db.from('settings').upsert({ key: 'pending_discovery_batches', value: stillPending });
  return updated;
}

/** Parse ISO 8601 duration (e.g. PT12M30S) to seconds */
function parseISO8601Duration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] ?? '0', 10) * 3600) +
    (parseInt(match[2] ?? '0', 10) * 60) +
    parseInt(match[3] ?? '0', 10);
}

function emptyResult(): DiscoverResult {
  return {
    searchesPerformed: 0,
    channelsDiscovered: 0,
    facelessEstimated: 0,
    estimatedCostUSD: 0,
    stoppedByQuota: false,
    stoppedByTimeout: false,
  };
}
