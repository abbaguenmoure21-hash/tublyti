import { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '../providers/embeddings';

const BATCH_SIZE = 32;

function formatVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Embed video titles that have no title_embedding yet.
 * Most recent first so fresh videos get embeddings before old ones.
 *
 * @param maxCount - max videos to embed in this run (0 = unlimited). Default: 0.
 */
export async function runEmbedAll(
  db: SupabaseClient,
  embedder: EmbeddingProvider,
  deadlineMs: number,
  maxCount = 0,
): Promise<{ embedded: number }> {
  let totalEmbedded = 0;

  while (Date.now() < deadlineMs) {
    if (maxCount > 0 && totalEmbedded >= maxCount) break;

    const take = maxCount > 0
      ? Math.min(BATCH_SIZE, maxCount - totalEmbedded)
      : BATCH_SIZE;

    const { data: videos } = await db
      .from('videos')
      .select('id, title')
      .is('title_embedding', null)
      .not('title', 'is', null)
      .order('published_at', { ascending: false })
      .limit(take);

    if (!videos || videos.length === 0) break;

    const texts = videos.map((v) => v.title as string);
    const embeddings = await embedder.embed(texts, 'document');

    for (let i = 0; i < videos.length; i++) {
      await db
        .from('videos')
        .update({ title_embedding: formatVector(embeddings[i]) })
        .eq('id', videos[i].id);
    }

    totalEmbedded += videos.length;

    if (videos.length < take) break;
  }

  return { embedded: totalEmbedded };
}
