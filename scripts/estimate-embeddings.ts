/**
 * Estimate embedding cost for videos without title_embedding.
 * Usage: npx tsx scripts/estimate-embeddings.ts
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

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Count videos < 90 days without embedding
  const { count: withoutEmbedding } = await db
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .is('title_embedding', null)
    .not('title', 'is', null)
    .gte('published_at', cutoff);

  // Count total videos < 90 days
  const { count: totalRecent } = await db
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .gte('published_at', cutoff);

  // Count already embedded
  const { count: withEmbedding } = await db
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .not('title_embedding', 'is', null)
    .gte('published_at', cutoff);

  // Sample titles to estimate token count
  const { data: sampleTitles } = await db
    .from('videos')
    .select('title')
    .is('title_embedding', null)
    .not('title', 'is', null)
    .gte('published_at', cutoff)
    .limit(100);

  const avgChars = sampleTitles
    ? sampleTitles.reduce((s, v) => s + (v.title?.length ?? 0), 0) / sampleTitles.length
    : 50;
  const avgTokens = Math.ceil(avgChars / 4); // rough estimate: 4 chars/token

  const totalTokens = (withoutEmbedding ?? 0) * avgTokens;
  // Voyage voyage-4-lite pricing: $0.02 per 1M tokens (via MongoDB Atlas free tier: 200M tokens)
  const costUSD = (totalTokens / 1_000_000) * 0.02;

  // Per niche breakdown
  const { data: niches } = await db.from('niches').select('id, name');
  const breakdown: { niche: string; count: number }[] = [];

  for (const niche of niches ?? []) {
    const { data: channels } = await db
      .from('channels')
      .select('id')
      .eq('niche_id', niche.id);

    if (!channels?.length) {
      breakdown.push({ niche: niche.name, count: 0 });
      continue;
    }

    const channelIds = channels.map((c) => c.id);
    const { count } = await db
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .in('channel_id', channelIds)
      .is('title_embedding', null)
      .not('title', 'is', null)
      .gte('published_at', cutoff);

    breakdown.push({ niche: niche.name, count: count ?? 0 });
  }

  console.log('=== Estimation des embeddings ===\n');
  console.log(`Vidéos < 90 j total : ${totalRecent}`);
  console.log(`Déjà embeddées      : ${withEmbedding}`);
  console.log(`À embedder          : ${withoutEmbedding}`);
  console.log(`\nTaille moyenne titre : ${avgChars.toFixed(0)} chars (~${avgTokens} tokens)`);
  console.log(`Tokens estimés       : ${totalTokens.toLocaleString()}`);
  console.log(`Coût Voyage 4-lite   : $${costUSD.toFixed(4)}`);
  console.log(`(200M tokens gratuits via MongoDB Atlas)`);
  console.log('\nPar niche :');
  for (const b of breakdown) {
    console.log(`  ${b.niche}: ${b.count} vidéos`);
  }
}

main().catch(console.error);
