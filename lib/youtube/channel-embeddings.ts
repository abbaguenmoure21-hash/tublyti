import { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '@/lib/providers/embeddings';

/**
 * Compute average embedding of last 20 video titles per channel.
 * Store in channels.embedding for nearest-neighbor similarity search.
 */
export async function computeChannelEmbeddings(
  db: SupabaseClient,
  embedder: EmbeddingProvider,
  deadlineMs: number,
): Promise<{ channelsEmbedded: number }> {
  const isTimedOut = () => Date.now() >= deadlineMs;
  let channelsEmbedded = 0;

  // Find channels that need embedding updates:
  // - No embedding yet, or
  // - Have new videos since embedding was last computed
  // For simplicity, re-embed channels that have no embedding
  const { data: channels } = await db
    .from('channels')
    .select('id')
    .is('embedding', null)
    .eq('status', 'active')
    .limit(20);

  if (!channels?.length) return { channelsEmbedded: 0 };

  for (const channel of channels) {
    if (isTimedOut()) break;

    // Get last 20 video titles
    const { data: videos } = await db
      .from('videos')
      .select('title')
      .eq('channel_id', channel.id)
      .not('title', 'is', null)
      .order('published_at', { ascending: false })
      .limit(20);

    if (!videos?.length || videos.length < 3) continue;

    const titles = videos
      .map((v) => v.title as string)
      .filter((t) => t.length > 3);

    if (titles.length < 3) continue;

    try {
      // Embed all titles
      const embeddings = await embedder.embed(titles, 'document');

      // Compute average embedding
      const dims = embedder.dimensions();
      const avg = new Float64Array(dims);
      for (const emb of embeddings) {
        for (let i = 0; i < dims; i++) {
          avg[i] += emb[i];
        }
      }
      // Normalize
      let norm = 0;
      for (let i = 0; i < dims; i++) {
        avg[i] /= embeddings.length;
        norm += avg[i] * avg[i];
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let i = 0; i < dims; i++) {
          avg[i] /= norm;
        }
      }

      const vecStr = `[${Array.from(avg).join(',')}]`;

      await db
        .from('channels')
        .update({ embedding: vecStr })
        .eq('id', channel.id);

      channelsEmbedded++;
    } catch (err) {
      console.error(`Embedding error for channel ${channel.id}: ${(err as Error).message}`);
    }
  }

  return { channelsEmbedded };
}

/**
 * Find similar channels by embedding similarity.
 */
export async function findSimilarChannels(
  db: SupabaseClient,
  channelId: string,
  limit = 5,
): Promise<{ id: string; title: string; subscriberCount: number; nicheId: string; similarity: number }[]> {
  // Get the reference channel's embedding
  const { data: channel } = await db
    .from('channels')
    .select('id, embedding')
    .eq('id', channelId)
    .single();

  if (!channel?.embedding) return [];

  const { data: results, error } = await db.rpc('match_channels', {
    query_embedding: channel.embedding,
    match_threshold: 0.3,
    match_count: limit,
    exclude_id: channelId,
  });

  if (error || !results) return [];

  return results.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    title: r.title as string,
    subscriberCount: Number(r.subscriber_count ?? 0),
    nicheId: r.niche_id as string,
    similarity: Number(r.similarity),
  }));
}
