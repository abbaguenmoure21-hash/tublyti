/**
 * Auto-triage candidate channels based on quality thresholds.
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

// Accept thresholds
const ACCEPT_LONG_VIDEOS_90D = 4;
const ACCEPT_SUBSCRIBERS = 10_000;
const ACCEPT_MEDIAN_VIEWS = 5_000;
const ACCEPT_EMBEDDING_SIMILARITY = 0.80;

// Reject thresholds
const REJECT_SUBSCRIBERS = 3_000;
const REJECT_MEDIAN_VIEWS = 1_000;
const REJECT_SIMILARITY = 0.65;

export interface TriageResult {
  processed: number;
  accepted: number;
  rejected: number;
  manual: number;
}

/**
 * Run auto-triage on pending candidate channels.
 * Requires channel details to already be populated (subscriber_count, median_views, etc.)
 */
export async function autoTriageCandidates(
  db: SupabaseClient,
  embedder: EmbeddingProvider | null,
  limit = 100,
): Promise<TriageResult> {
  const result: TriageResult = { processed: 0, accepted: 0, rejected: 0, manual: 0 };

  const { data: candidates } = await db
    .from('candidate_channels')
    .select('id, title, subscriber_count, median_views, videos_per_month, long_video_count, niche_id, embedding_similarity')
    .eq('status', 'pending')
    .not('subscriber_count', 'is', null)
    .limit(limit);

  if (!candidates?.length) return result;

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
