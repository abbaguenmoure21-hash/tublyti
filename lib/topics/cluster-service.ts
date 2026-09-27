import { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '../providers/embeddings';

const SIMILARITY_THRESHOLD = 0.85;
const MIN_CLUSTER_SIZE = 3;

// ── Types ────────────────────────────────────────────────────────────
export interface ClusterResult {
  videosEmbedded: number;
  anglesEmbedded: number;
  videosAttached: number;
  topicsProposed: number;
}

interface EmbeddableItem {
  id: string;
  text: string;
  type: 'video' | 'angle';
}

// ── Helpers ──────────────────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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

// ── Main service ─────────────────────────────────────────────────────
export async function runClustering(
  db: SupabaseClient,
  embedder: EmbeddingProvider,
  deadlineMs: number,
): Promise<ClusterResult> {
  const result: ClusterResult = {
    videosEmbedded: 0,
    anglesEmbedded: 0,
    videosAttached: 0,
    topicsProposed: 0,
  };

  const isTimedOut = () => Date.now() >= deadlineMs;

  // ── Step 1: Embed video titles without embeddings ────────────────
  const { data: unembeddedVideos } = await db
    .from('videos')
    .select('id, title')
    .is('title_embedding', null)
    .not('title', 'is', null)
    .limit(128);

  if (unembeddedVideos && unembeddedVideos.length > 0 && !isTimedOut()) {
    const texts = unembeddedVideos.map((v) => v.title as string);
    try {
      const embeddings = await embedder.embed(texts, 'document');
      for (let i = 0; i < unembeddedVideos.length; i++) {
        await db
          .from('videos')
          .update({ title_embedding: formatVector(embeddings[i]) })
          .eq('id', unembeddedVideos[i].id);
        result.videosEmbedded++;
      }
    } catch (err) {
      console.error(`Embedding error: ${(err as Error).message}`);
    }
  }

  if (isTimedOut()) return result;

  // ── Step 2: Embed requested_angles without embeddings ────────────
  // We store angle embeddings in a lightweight way: embed and use for clustering
  // but don't persist them (they're used transiently for topic matching)
  const { data: unprocessedLabels } = await db
    .from('comment_labels')
    .select('comment_id, requested_angle')
    .neq('label', 'none')
    .not('requested_angle', 'is', null)
    .limit(128);

  // Filter to angles not yet associated with a topic via their video
  const angleItems: EmbeddableItem[] = [];
  if (unprocessedLabels && unprocessedLabels.length > 0) {
    for (const label of unprocessedLabels) {
      if (label.requested_angle) {
        angleItems.push({
          id: label.comment_id,
          text: label.requested_angle,
          type: 'angle',
        });
      }
    }
    result.anglesEmbedded = angleItems.length;
  }

  if (isTimedOut()) return result;

  // ── Step 3: Attach videos to existing topics ─────────────────────
  const { data: unattachedVideos } = await db
    .from('videos')
    .select('id, title, title_embedding')
    .is('topic_id', null)
    .not('title_embedding', 'is', null)
    .limit(200);

  if (!unattachedVideos || unattachedVideos.length === 0) return result;

  // Load all active topic embeddings
  const { data: topics } = await db
    .from('topics')
    .select('id, label, embedding, niche_id')
    .in('status', ['active', 'proposed'])
    .not('embedding', 'is', null);

  const topicEmbeddings = (topics ?? []).map((t) => ({
    id: t.id as string,
    nicheId: t.niche_id as string,
    embedding: parseEmbedding(t.embedding),
  }));

  // For each unattached video, find best matching topic
  const orphans: { id: string; embedding: number[] }[] = [];

  for (const video of unattachedVideos) {
    if (isTimedOut()) break;

    const videoEmb = parseEmbedding(video.title_embedding);
    if (videoEmb.length === 0) continue;

    let bestSim = 0;
    let bestTopicId: string | null = null;

    for (const topic of topicEmbeddings) {
      if (topic.embedding.length === 0) continue;
      const sim = cosineSimilarity(videoEmb, topic.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestTopicId = topic.id;
      }
    }

    if (bestTopicId && bestSim >= SIMILARITY_THRESHOLD) {
      await db
        .from('videos')
        .update({ topic_id: bestTopicId })
        .eq('id', video.id);
      result.videosAttached++;

      // Recalculate topic embedding (average of members)
      await recalculateTopicEmbedding(db, bestTopicId);
    } else {
      orphans.push({ id: video.id, embedding: videoEmb });
    }
  }

  if (isTimedOut()) return result;

  // ── Step 4: Cluster orphans into proposed topics ─────────────────
  if (orphans.length >= MIN_CLUSTER_SIZE) {
    const clusters = greedyCluster(orphans, SIMILARITY_THRESHOLD);

    for (const cluster of clusters) {
      if (isTimedOut()) break;
      if (cluster.length < MIN_CLUSTER_SIZE) continue;

      // Get video titles for the cluster label
      const clusterIds = cluster.map((c) => c.id);
      const { data: clusterVideos } = await db
        .from('videos')
        .select('id, title, channel_id')
        .in('id', clusterIds);

      if (!clusterVideos || clusterVideos.length === 0) continue;

      // Find the niche from the first video's channel
      const { data: channel } = await db
        .from('channels')
        .select('niche_id')
        .eq('id', clusterVideos[0].channel_id)
        .single();

      const nicheId = channel?.niche_id;
      if (!nicheId) continue;

      // Create proposed topic with average embedding
      const clusterEmbeddings = cluster.map((c) => c.embedding);
      const avgEmb = averageEmbedding(clusterEmbeddings);

      // Use the shortest title as the label
      const label = clusterVideos
        .map((v) => v.title as string)
        .sort((a, b) => a.length - b.length)[0];

      const { data: newTopic } = await db
        .from('topics')
        .insert({
          workspace_id: '00000000-0000-0000-0000-000000000001',
          niche_id: nicheId,
          label,
          embedding: formatVector(avgEmb),
          status: 'proposed',
        })
        .select('id')
        .single();

      if (newTopic) {
        // Attach cluster videos to the new topic
        await db
          .from('videos')
          .update({ topic_id: newTopic.id })
          .in('id', clusterIds);
        result.topicsProposed++;
      }
    }
  }

  return result;
}

// ── Greedy clustering ────────────────────────────────────────────────
function greedyCluster(
  items: { id: string; embedding: number[] }[],
  threshold: number,
): { id: string; embedding: number[] }[][] {
  const used = new Set<number>();
  const clusters: { id: string; embedding: number[] }[][] = [];

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const cluster = [items[i]];
    used.add(i);

    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const sim = cosineSimilarity(items[i].embedding, items[j].embedding);
      if (sim >= threshold) {
        cluster.push(items[j]);
        used.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

// ── Parse pgvector string to number array ────────────────────────────
function parseEmbedding(raw: unknown): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      // pgvector format: [0.1,0.2,...]
      return raw
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(Number);
    }
  }
  return [];
}

// ── Recalculate topic embedding from member videos ───────────────────
async function recalculateTopicEmbedding(
  db: SupabaseClient,
  topicId: string,
): Promise<void> {
  const { data: members } = await db
    .from('videos')
    .select('title_embedding')
    .eq('topic_id', topicId)
    .not('title_embedding', 'is', null)
    .limit(100);

  if (!members || members.length === 0) return;

  const embeddings = members
    .map((m) => parseEmbedding(m.title_embedding))
    .filter((e) => e.length > 0);

  if (embeddings.length === 0) return;

  const avg = averageEmbedding(embeddings);
  await db
    .from('topics')
    .update({ embedding: formatVector(avg) })
    .eq('id', topicId);
}
