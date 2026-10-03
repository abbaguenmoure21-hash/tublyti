/**
 * Embed all video titles without title_embedding (< 90 days).
 * Processes in batches of 128 (Voyage API limit).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

import { VoyageEmbeddingProvider } from '../lib/providers/voyage-embeddings';
import { SupabaseJobRunner } from '../lib/jobs/supabase-runner';

const BATCH_SIZE = 32;

function formatVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const embedder = new VoyageEmbeddingProvider();
  const runner = new SupabaseJobRunner(db);
  const job = await runner.start('embed');

  let totalEmbedded = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const { data: videos } = await db
        .from('videos')
        .select('id, title')
        .is('title_embedding', null)
        .not('title', 'is', null)
        .limit(BATCH_SIZE);

      if (!videos || videos.length === 0) {
        hasMore = false;
        break;
      }

      const texts = videos.map((v) => v.title as string);
      const embeddings = await embedder.embed(texts, 'document');

      for (let i = 0; i < videos.length; i++) {
        const { error } = await db
          .from('videos')
          .update({ title_embedding: formatVector(embeddings[i]) })
          .eq('id', videos[i].id);

        if (error) {
          console.error(`  Error embedding ${videos[i].id}: ${error.message}`);
        }
      }

      totalEmbedded += videos.length;
      console.log(`  Embedded: ${totalEmbedded} (batch of ${videos.length})`);

      if (videos.length < BATCH_SIZE) hasMore = false;
    }

    await runner.finish(job.id, { quotaUsed: 0, itemsProcessed: totalEmbedded });
    console.log(`\nDone. ${totalEmbedded} videos embedded.`);
  } catch (err) {
    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: totalEmbedded,
      error: err instanceof Error ? err.message : String(err),
    });
    console.error(`Error after ${totalEmbedded} embeddings:`, err);
  }
}

main().catch(console.error);
