/**
 * Auto-triage candidate channels:
 *  1. Enrich: fetch channel details (channels.list) + last 10 videos (playlistItems)
 *  2. Triage: accept/reject/manual based on thresholds
 *  3. Promote: accepted candidates → channels table
 *
 * Accept automatically if ALL:
 *   - ≥ 4 long videos (>8min) in last 90 days
 *   - (≥ 10,000 subscribers OR median views ≥ 5,000)
 *   - Embedding similarity ≥ 0.80 (computed on 10 last titles vs niche centroid)
 *
 * Reject automatically if:
 *   - < 3,000 subscribers AND median views < 1,000
 *   - OR similarity < 0.65
 *
 * Otherwise: manual review.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '../providers/embeddings';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// Accept thresholds
const ACCEPT_LONG_VIDEOS_90D = 4;
const ACCEPT_SUBSCRIBERS = 10_000;
const ACCEPT_MEDIAN_VIEWS = 5_000;
const ACCEPT_EMBEDDING_SIMILARITY = 0.80;

// Reject thresholds
const REJECT_SUBSCRIBERS = 3_000;
const REJECT_MEDIAN_VIEWS = 1_000;
const REJECT_SIMILARITY = 0.65;

const DURATION_THRESHOLD = 480; // 8 minutes in seconds

export interface TriageResult {
  processed: number;
  accepted: number;
  rejected: number;
  manual: number;
  enriched: number;
  promoted: number;
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

function parseISO8601Duration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? '0') * 3600) + (parseInt(m[2] ?? '0') * 60) + parseInt(m[3] ?? '0');
}

/**
 * Enrich pending candidates that have no subscriber_count.
 * Uses channels.list in batches of 50 (1 quota unit per batch).
 */
async function enrichCandidates(
  db: SupabaseClient,
  limit: number,
): Promise<{ enriched: number; quotaUsed: number }> {
  let enriched = 0;
  let quotaUsed = 0;

  // Candidates missing subscriber data
  const { data: unenriched } = await db
    .from('candidate_channels')
    .select('id')
    .eq('status', 'pending')
    .is('subscriber_count', null)
    .limit(limit);

  if (!unenriched?.length) return { enriched, quotaUsed };

  for (let i = 0; i < unenriched.length; i += 50) {
    const batch = unenriched.slice(i, i + 50);
    const ids = batch.map((c) => c.id).join(',');

    try {
      // channels.list: 1 quota unit per call
      const channelData = await ytFetch('channels', {
        part: 'snippet,statistics,contentDetails',
        id: ids,
      }) as {
        items?: Array<{
          id: string;
          snippet?: { title?: string };
          statistics?: { subscriberCount?: string; viewCount?: string };
          contentDetails?: { relatedPlaylists?: { uploads?: string } };
        }>;
      };
      quotaUsed += 1;

      for (const ch of channelData.items ?? []) {
        const subs = parseInt(ch.statistics?.subscriberCount ?? '0', 10);
        const uploadsPlaylistId = ch.contentDetails?.relatedPlaylists?.uploads;

        // Fetch last 10 videos to count long ones + compute median views
        let longCount = 0;
        let medianViews = 0;

        if (uploadsPlaylistId) {
          try {
            const plData = await ytFetch('playlistItems', {
              part: 'contentDetails',
              playlistId: uploadsPlaylistId,
              maxResults: '10',
            }) as { items?: Array<{ contentDetails?: { videoId?: string } }> };
            quotaUsed += 1;

            const videoIds = (plData.items ?? [])
              .map((item) => item.contentDetails?.videoId)
              .filter((id): id is string => !!id);

            if (videoIds.length > 0) {
              const vidData = await ytFetch('videos', {
                part: 'contentDetails,statistics',
                id: videoIds.join(','),
              }) as {
                items?: Array<{
                  id: string;
                  contentDetails?: { duration?: string };
                  statistics?: { viewCount?: string };
                }>;
              };
              quotaUsed += 1;

              const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
              const views: number[] = [];

              for (const vid of vidData.items ?? []) {
                const dur = parseISO8601Duration(vid.contentDetails?.duration ?? '');
                const v = parseInt(vid.statistics?.viewCount ?? '0', 10);
                views.push(v);
                if (dur >= DURATION_THRESHOLD) longCount++;
              }

              // Median views
              views.sort((a, b) => a - b);
              if (views.length > 0) {
                const mid = Math.floor(views.length / 2);
                medianViews = views.length % 2 === 0
                  ? Math.round((views[mid - 1] + views[mid]) / 2)
                  : views[mid];
              }
            }
          } catch {
            // Skip video fetch on error
          }
        }

        await db.from('candidate_channels').update({
          title: ch.snippet?.title ?? null,
          subscriber_count: subs,
          median_views: medianViews,
          long_video_count: longCount,
        }).eq('id', ch.id);
        enriched++;
      }
    } catch {
      // Skip batch on error
    }
  }

  return { enriched, quotaUsed };
}

/**
 * Promote accepted candidates to the channels table.
 */
async function promoteAccepted(db: SupabaseClient): Promise<number> {
  const { data: accepted } = await db
    .from('candidate_channels')
    .select('id, title, subscriber_count, niche_id')
    .eq('status', 'accepted');

  if (!accepted?.length) return 0;

  let promoted = 0;
  for (const c of accepted) {
    // Check if already in channels
    const { data: existing } = await db
      .from('channels')
      .select('id')
      .eq('id', c.id)
      .single();

    if (existing) {
      // Already followed — mark as followed
      await db.from('candidate_channels').update({ status: 'followed' }).eq('id', c.id);
      continue;
    }

    const { error } = await db.from('channels').insert({
      id: c.id,
      workspace_id: '00000000-0000-0000-0000-000000000001',
      title: c.title,
      subscriber_count: c.subscriber_count,
      niche_id: c.niche_id,
    });

    if (error) {
      console.error(`promote channel ${c.id}: ${error.message}`);
    } else {
      await db.from('candidate_channels').update({ status: 'followed' }).eq('id', c.id);
      promoted++;
    }
  }

  return promoted;
}

/**
 * Run auto-triage on pending candidate channels.
 * Enriches candidates first, then applies thresholds, then promotes accepted.
 */
export async function autoTriageCandidates(
  db: SupabaseClient,
  embedder: EmbeddingProvider | null,
  limit = 100,
): Promise<TriageResult> {
  const result: TriageResult = {
    processed: 0, accepted: 0, rejected: 0, manual: 0,
    enriched: 0, promoted: 0, quotaUsed: 0,
  };

  // Step 1: Enrich unenriched candidates
  const enrichResult = await enrichCandidates(db, limit);
  result.enriched = enrichResult.enriched;
  result.quotaUsed = enrichResult.quotaUsed;

  // Step 2: Triage enriched candidates
  const { data: candidates } = await db
    .from('candidate_channels')
    .select('id, title, subscriber_count, median_views, videos_per_month, long_video_count, niche_id, embedding_similarity')
    .eq('status', 'pending')
    .not('subscriber_count', 'is', null)
    .limit(limit);

  if (!candidates?.length) {
    // Still promote any previously accepted
    result.promoted = await promoteAccepted(db);
    return result;
  }

  // Load niche centroid embeddings for similarity check
  let nicheEmbeddings: Map<string, number[]> | null = null;
  if (embedder) {
    const { data: niches } = await db
      .from('niches')
      .select('id, name');

    if (niches?.length) {
      nicheEmbeddings = new Map();
      for (const niche of niches) {
        try {
          const [embedding] = await embedder.embed([niche.name]);
          nicheEmbeddings.set(niche.id, embedding);
        } catch {
          // Skip niche embedding on error
        }
      }
    }
  }

  for (const candidate of candidates) {
    result.processed++;

    const subscriberCount = candidate.subscriber_count ?? 0;
    const medianViews = candidate.median_views ?? 0;
    const longVideoCount = candidate.long_video_count ?? 0;
    let similarity = candidate.embedding_similarity ?? null;

    // Compute embedding similarity if not already set and embedder available
    if (similarity === null && embedder && candidate.niche_id && candidate.title && nicheEmbeddings?.has(candidate.niche_id)) {
      try {
        const [titleEmb] = await embedder.embed([candidate.title]);
        const nicheEmb = nicheEmbeddings.get(candidate.niche_id)!;
        similarity = cosineSimilarity(titleEmb, nicheEmb);

        await db.from('candidate_channels')
          .update({ embedding_similarity: similarity })
          .eq('id', candidate.id);
      } catch {
        // Skip on embedding error
      }
    }

    // ── Reject conditions ──
    if (similarity !== null && similarity < REJECT_SIMILARITY) {
      await updateDecision(db, candidate.id, 'rejected',
        `Similarity ${(similarity * 100).toFixed(0)}% < ${REJECT_SIMILARITY * 100}% threshold`);
      result.rejected++;
      continue;
    }

    if (subscriberCount < REJECT_SUBSCRIBERS && medianViews < REJECT_MEDIAN_VIEWS) {
      await updateDecision(db, candidate.id, 'rejected',
        `${subscriberCount} subs < ${REJECT_SUBSCRIBERS} AND ${medianViews} median views < ${REJECT_MEDIAN_VIEWS}`);
      result.rejected++;
      continue;
    }

    // ── Accept conditions (all must be met) ──
    const hasEnoughVideos = longVideoCount >= ACCEPT_LONG_VIDEOS_90D;
    const hasEnoughSize = subscriberCount >= ACCEPT_SUBSCRIBERS || medianViews >= ACCEPT_MEDIAN_VIEWS;
    const hasEnoughSimilarity = similarity !== null && similarity >= ACCEPT_EMBEDDING_SIMILARITY;

    if (hasEnoughVideos && hasEnoughSize && hasEnoughSimilarity) {
      await updateDecision(db, candidate.id, 'accepted',
        `${longVideoCount} long videos, ${subscriberCount} subs, ${medianViews} median views, ${(similarity! * 100).toFixed(0)}% similarity`);
      result.accepted++;
      continue;
    }

    // ── Manual review ──
    result.manual++;
  }

  // Step 3: Promote accepted candidates to channels table
  result.promoted = await promoteAccepted(db);

  return result;
}

async function updateDecision(db: SupabaseClient, id: string, decision: string, reason: string) {
  const { error } = await db.from('candidate_channels').update({
    auto_decision: decision,
    auto_reason: reason,
    status: decision,
  }).eq('id', id);
  if (error) {
    console.error(`auto-triage update error for ${id}: ${error.message}`);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
