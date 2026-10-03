import { SupabaseClient } from '@supabase/supabase-js';

const SAME_NICHE_THRESHOLD = 0.66;
const CROSS_NICHE_THRESHOLD = 0.75;
const PAGE_SIZE = 500;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function parseEmbedding(raw: unknown): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch {
      return raw.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
  }
  return [];
}

function averageEmbedding(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dims = embeddings[0].length;
  const avg = new Array(dims).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dims; i++) avg[i] += emb[i];
  }
  const norm = Math.sqrt(avg.reduce((s, v) => s + v * v, 0)) || 1;
  return avg.map((v) => v / norm);
}

function formatVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

interface TopicRef {
  id: string;
  nicheId: string;
  embedding: number[];
}

/**
 * Attach ALL unattached videos (< 90 days, has embedding) to the best
 * matching topic using a two-tier strategy:
 *   1. Same-niche match ≥ 0.68 (relaxed — same domain tolerates title variation)
 *   2. Cross-niche match ≥ 0.75 (strict — higher bar compensates niche mismatch)
 * Same-niche match is preferred when both pass their threshold.
 * Also recalculates topic embeddings after attachment.
 */
export async function runAttachAll(
  db: SupabaseClient,
  deadlineMs: number,
): Promise<{ attached: number; orphans: number }> {
  // Load topics with embeddings
  const { data: topics } = await db
    .from('topics')
    .select('id, niche_id, embedding')
    .in('status', ['proposed', 'active', 'in_production'])
    .not('embedding', 'is', null);

  const topicList: TopicRef[] = (topics ?? [])
    .map((t) => ({
      id: t.id as string,
      nicheId: t.niche_id as string,
      embedding: parseEmbedding(t.embedding),
    }))
    .filter((t) => t.embedding.length > 0);

  if (topicList.length === 0) return { attached: 0, orphans: 0 };

  // Channel → niche mapping
  const { data: channels } = await db.from('channels').select('id, niche_id');
  const channelNiche = new Map((channels ?? []).map((c) => [c.id, c.niche_id]));

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  let offset = 0;
  let totalAttached = 0;
  let totalOrphans = 0;
  const touchedTopics = new Set<string>();

  while (Date.now() < deadlineMs) {
    const { data: videos } = await db
      .from('videos')
      .select('id, channel_id, title_embedding')
      .is('topic_id', null)
      .not('title_embedding', 'is', null)
      .gte('published_at', cutoff)
      .range(offset, offset + PAGE_SIZE - 1);

    if (!videos?.length) break;

    for (const video of videos) {
      const videoEmb = parseEmbedding(video.title_embedding);
      if (videoEmb.length === 0) continue;

      const nicheId = channelNiche.get(video.channel_id);
      if (!nicheId) { totalOrphans++; continue; }

      // Find best same-niche and best cross-niche match
      let bestSameSim = 0;
      let bestSameTopicId: string | null = null;
      let bestCrossSim = 0;
      let bestCrossTopicId: string | null = null;

      for (const topic of topicList) {
        const sim = cosineSimilarity(videoEmb, topic.embedding);
        if (topic.nicheId === nicheId) {
          if (sim > bestSameSim) { bestSameSim = sim; bestSameTopicId = topic.id; }
        } else {
          if (sim > bestCrossSim) { bestCrossSim = sim; bestCrossTopicId = topic.id; }
        }
      }

      // Tier 1: same-niche ≥ 0.68 (preferred)
      if (bestSameTopicId && bestSameSim >= SAME_NICHE_THRESHOLD) {
        await db.from('videos').update({ topic_id: bestSameTopicId }).eq('id', video.id);
        totalAttached++;
        touchedTopics.add(bestSameTopicId);
      }
      // Tier 2: cross-niche ≥ 0.75 (fallback)
      else if (bestCrossTopicId && bestCrossSim >= CROSS_NICHE_THRESHOLD) {
        await db.from('videos').update({ topic_id: bestCrossTopicId }).eq('id', video.id);
        totalAttached++;
        touchedTopics.add(bestCrossTopicId);
      }
      else {
        totalOrphans++;
      }
    }

    offset += videos.length;
    if (videos.length < PAGE_SIZE) break;
  }

  // Recalculate embeddings for all touched topics
  for (const topicId of Array.from(touchedTopics)) {
    const { data: members } = await db
      .from('videos')
      .select('title_embedding')
      .eq('topic_id', topicId)
      .not('title_embedding', 'is', null)
      .limit(200);

    if (!members?.length) continue;

    const embeddings = members
      .map((m) => parseEmbedding(m.title_embedding))
      .filter((e) => e.length > 0);

    if (embeddings.length === 0) continue;

    const avg = averageEmbedding(embeddings);
    await db.from('topics').update({ embedding: formatVector(avg) }).eq('id', topicId);
  }

  return { attached: totalAttached, orphans: totalOrphans };
}
