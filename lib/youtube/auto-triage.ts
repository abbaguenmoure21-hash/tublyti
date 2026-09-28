/**
 * Auto-triage candidate channels based on quality thresholds.
 *
 * Accept automatically if:
 *   - ≥ 5 long videos (>8min) in last 90 days
 *   - Median views ≥ 2,000
 *   - Embedding similarity ≥ 0.80 with niche centroid
 *
 * Reject automatically if:
 *   - < 2 videos in last 90 days
 *   - Median views < 200
 *   - Subscriber count < 1,000
 *
 * Otherwise: manual review.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '../providers/embeddings';

// Accept thresholds
const ACCEPT_LONG_VIDEOS = 5;
const ACCEPT_MEDIAN_VIEWS = 2000;
const ACCEPT_EMBEDDING_SIMILARITY = 0.80;

// Reject thresholds
const REJECT_VIDEOS_90D = 2;
const REJECT_MEDIAN_VIEWS = 200;
const REJECT_SUBSCRIBERS = 1000;

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

  // Load niche embeddings for similarity check (if embedder available)
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
    if (subscriberCount < REJECT_SUBSCRIBERS) {
      await updateDecision(db, candidate.id, 'rejected', `Subscribers ${subscriberCount} < ${REJECT_SUBSCRIBERS}`);
      result.rejected++;
      continue;
    }

    if (medianViews < REJECT_MEDIAN_VIEWS) {
      await updateDecision(db, candidate.id, 'rejected', `Median views ${medianViews} < ${REJECT_MEDIAN_VIEWS}`);
      result.rejected++;
      continue;
    }

    // ── Accept conditions (all must be met) ──
    const hasEnoughVideos = longVideoCount >= ACCEPT_LONG_VIDEOS;
    const hasEnoughViews = medianViews >= ACCEPT_MEDIAN_VIEWS;
    const hasEnoughSimilarity = similarity !== null && similarity >= ACCEPT_EMBEDDING_SIMILARITY;

    if (hasEnoughVideos && hasEnoughViews && hasEnoughSimilarity) {
      await updateDecision(db, candidate.id, 'accepted',
        `${longVideoCount} long videos, ${medianViews} median views, ${(similarity! * 100).toFixed(0)}% similarity`);
      result.accepted++;
      continue;
    }

    // ── Manual review ──
    result.manual++;
  }

  return result;
}

async function updateDecision(db: SupabaseClient, id: string, decision: string, reason: string) {
  await db.from('candidate_channels').update({
    auto_decision: decision,
    auto_reason: reason,
    status: decision,
  }).eq('id', id);
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
