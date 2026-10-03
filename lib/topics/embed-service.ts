import { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '../providers/embeddings';

const BATCH_SIZE = 32;

function formatVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Embed ALL video titles that have no title_embedding yet.
 * No limit — processes until done or deadline.
 */
export async function runEmbedAll(
  db: SupabaseClient,
  embedder: EmbeddingProvider,
  deadlineMs: number,
): Promise<{ embedded: number }> {
  let totalEmbedded = 0;

  while (Date.now() < deadlineMs) {
    const { data: videos } = await db
      .from('videos')
      .select('id, title')
      .is('title_embedding', null)
      .not('title', 'is', null)
      .limit(BATCH_SIZE);

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

    if (videos.length < BATCH_SIZE) break;
  }

  return { embedded: totalEmbedded };
}
