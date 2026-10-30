import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '../providers/embeddings';
import { reserveAiBudget, settleAiBudget } from '../ai/budget';
import { HAIKU_45, costUsd } from '../ai/pricing';

const CLUSTER_SIMILARITY_THRESHOLD = 0.80;
const MIN_CLUSTER_SIZE = 3;

// ── Types ────────────────────────────────────────────────────────────
export interface ClusterResult {
  videosEmbedded: number;
  anglesEmbedded: number;
  videosAttached: number;
  topicsProposed: number;
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

/**
 * Propose new topics by clustering unattached, embedded videos.
 * Embedding and attachment are now handled by separate services
 * (embed-service.ts, attach-service.ts).
 */
export async function runClustering(
  db: SupabaseClient,
  _embedder: EmbeddingProvider,
  deadlineMs: number,
): Promise<ClusterResult> {
  const result: ClusterResult = {
    videosEmbedded: 0,
    anglesEmbedded: 0,
    videosAttached: 0,
    topicsProposed: 0,
  };

  const isTimedOut = () => Date.now() >= deadlineMs;

  // Load unattached videos with embeddings (these are orphans after attach step)
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const allOrphans: { id: string; embedding: number[]; channel_id: string }[] = [];
  let offset = 0;
  const PAGE = 500;

  while (!isTimedOut()) {
    const { data: videos } = await db
      .from('videos')
      .select('id, title_embedding, channel_id')
      .is('topic_id', null)
      .not('title_embedding', 'is', null)
      .gte('published_at', cutoff)
      .range(offset, offset + PAGE - 1);

    if (!videos?.length) break;

    for (const v of videos) {
      const emb = parseEmbedding(v.title_embedding);
      if (emb.length > 0) allOrphans.push({ id: v.id, embedding: emb, channel_id: v.channel_id });
    }

    if (videos.length < PAGE) break;
    offset += videos.length;
  }

  if (isTimedOut() || allOrphans.length < MIN_CLUSTER_SIZE) return result;

  // Cluster orphans into proposed topics
  const orphans = allOrphans.map((o) => ({ id: o.id, embedding: o.embedding }));
  if (orphans.length >= MIN_CLUSTER_SIZE) {
    const clusters = greedyCluster(orphans, CLUSTER_SIMILARITY_THRESHOLD);

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

      // Get niche name for context
      const { data: nicheRow } = await db
        .from('niches')
        .select('name')
        .eq('id', nicheId)
        .single();
      const nicheName = nicheRow?.name ?? '';

      // Name the topic via Claude Haiku (2-6 English words) + generate 3 search queries
      const titles = clusterVideos.map((v) => v.title as string);
      const named = await nameTopicWithHaiku(db, titles, nicheName);

      // Skip if Haiku says it's off-niche
      if (!named) continue;

      const { data: newTopic } = await db
        .from('topics')
        .insert({
          workspace_id: '00000000-0000-0000-0000-000000000001',
          niche_id: nicheId,
          label: named.label,
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

        // Insert search queries
        for (const queryText of named.queries) {
          const { error: qErr } = await db.from('topic_queries').insert({
            workspace_id: '00000000-0000-0000-0000-000000000001',
            topic_id: newTopic.id,
            source: 'youtube',
            query_text: queryText,
            priority: 1,
          });
          if (qErr) console.error(`query insert error: ${qErr.message}`);
        }

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

// ── Name topic via Claude Haiku ────────────────────────────────────────
interface TopicNaming {
  label: string;
  queries: string[];
}

/** Fallback naming without AI: the shortest title of the cluster. */
function shortestTitleNaming(videoTitles: string[]): TopicNaming {
  const label = [...videoTitles].sort((a, b) => a.length - b.length)[0] ?? 'Unnamed topic';
  return { label, queries: [label.toLowerCase()] };
}

/** Upper bound reserved before the call (≈ 600 tokens in, 200 out). */
const NAMING_EST_USD = costUsd(HAIKU_45, 600, 200);

type MessagesClient = Pick<Anthropic, 'messages'>;

/**
 * Names a cluster with Claude Haiku. The monthly AI budget is reserved atomically before the call
 * (lib/ai/budget) and settled with the real cost; with the budget spent, no call is made and the
 * shortest title is used.
 */
export async function nameTopicWithHaiku(
  db: SupabaseClient,
  videoTitles: string[],
  nicheName: string,
  deps: { anthropic?: MessagesClient } = {},
): Promise<TopicNaming | null> {
  if (!process.env.ANTHROPIC_API_KEY && !deps.anthropic) return shortestTitleNaming(videoTitles);

  const reservation = await reserveAiBudget(db, NAMING_EST_USD).catch((e: Error) => {
    console.error(`Haiku naming: budget check failed (${e.message}), naming skipped`);
    return null;
  });
  if (!reservation?.ok) {
    if (reservation) console.log('  Haiku naming skipped: monthly AI budget reached');
    return shortestTitleNaming(videoTitles);
  }

  let settled = false;
  try {
    const anthropic = deps.anthropic ?? new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are classifying YouTube video clusters for the "${nicheName}" niche.

Given these video titles from a cluster:
${videoTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

1. If these videos are NOT about the "${nicheName}" niche, respond with: {"reject": true}
2. Otherwise, respond with a JSON object:
{
  "label": "2-6 word English topic name (lowercase, no articles)",
  "queries": ["search query 1", "search query 2", "search query 3"]
}

The label should capture the shared theme. The queries should be YouTube search terms to find more videos on this topic. Respond ONLY with valid JSON, no markdown.`,
      }],
    });

    const cost = costUsd(HAIKU_45, response.usage.input_tokens, response.usage.output_tokens);
    await settleAiBudget(db, reservation, cost);
    settled = true;
    await db.from('ai_spend').insert({
      action: 'name_topic',
      model: 'haiku-4.5',
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      cost_usd: cost,
      meta: { niche: nicheName },
    });

    let text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(text);

    if (parsed.reject) return null;
    if (!parsed.label || typeof parsed.label !== 'string') return null;

    return {
      label: parsed.label.slice(0, 100),
      queries: Array.isArray(parsed.queries)
        ? parsed.queries.filter((q: unknown) => typeof q === 'string').slice(0, 3)
        : [parsed.label.toLowerCase()],
    };
  } catch (err) {
    console.error(`Haiku naming error: ${(err as Error).message}`);
    // Nothing billed (call failed): give the reservation back.
    if (!settled) await settleAiBudget(db, reservation, 0).catch(() => undefined);
    return shortestTitleNaming(videoTitles);
  }
}

