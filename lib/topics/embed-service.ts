import { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '../providers/embeddings';

// 128 titles per embedding call (the provider splits further if needed); writes 10 at a time.
const BATCH_SIZE = 128;
const WRITE_CONCURRENCY = 10;

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

    const { data: videos, error: readErr } = await db
      .from('videos')
      .select('id, title')
      .is('title_embedding', null)
      .not('title', 'is', null)
      .order('published_at', { ascending: false })
      .limit(take);

    if (readErr) throw new Error(`embed: read videos: ${readErr.message}`);
    if (!videos || videos.length === 0) break;

    const texts = videos.map((v) => v.title as string);
    const embeddings = await embedder.embed(texts, 'document');

    // Parallel writes (was one awaited update after the other: ~3 000 sequential round-trips per night).
    let failed = 0;
    for (let k = 0; k < videos.length; k += WRITE_CONCURRENCY) {
      const results = await Promise.all(videos.slice(k, k + WRITE_CONCURRENCY).map((v, j) => db
        .from('videos')
        .update({ title_embedding: formatVector(embeddings[k + j]) })
        .eq('id', v.id)));
      for (const r of results) if (r.error) failed++;
    }
    // A batch that cannot be written would be re-selected (and re-embedded, paid) forever: stop.
    if (failed === videos.length) throw new Error(`embed: could not write any of ${videos.length} vectors`);
    if (failed > 0) console.error(`  [embed] ${failed}/${videos.length} vectors not written`);

    totalEmbedded += videos.length - failed;

    if (videos.length < take) break;
  }

  return { embedded: totalEmbedded };
}
