/**
 * Attach unattached videos to the closest topic using tiered matching:
 *   1. Same-niche ≥ 0.68 (tolerates title variation within niche)
 *   2. Cross-niche ≥ 0.75 (strict fallback for off-niche channel content)
 * Shows distribution per niche.
 *
 * Usage:
 *   npx tsx scripts/attach-videos.ts --dry-run    # show stats only (default)
 *   npx tsx scripts/attach-videos.ts --apply       # actually attach
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

const DRY_RUN = !process.argv.includes('--apply');
const SAME_NICHE_THRESHOLD = 0.66;
const CROSS_NICHE_THRESHOLD = 0.75;

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

import { SupabaseJobRunner } from '../lib/jobs/supabase-runner';

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const runner = new SupabaseJobRunner(db);
  const job = await runner.start('attach-videos');

  console.log(`\n=== Rattachement vidéos ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===\n`);

  // Load all topics with embeddings
  const { data: topics } = await db
    .from('topics')
    .select('id, niche_id, label, embedding')
    .in('status', ['proposed', 'active', 'in_production'])
    .not('embedding', 'is', null);

  const topicList = (topics ?? []).map((t) => ({
    id: t.id as string,
    nicheId: t.niche_id as string,
    label: t.label as string,
    embedding: parseEmbedding(t.embedding),
  })).filter((t) => t.embedding.length > 0);

  console.log(`Sujets avec embedding: ${topicList.length}\n`);

  // Load niches
  const { data: niches } = await db.from('niches').select('id, name');
  const nicheNames = new Map((niches ?? []).map((n) => [n.id, n.name]));

  // Get channels by niche
  const { data: channels } = await db.from('channels').select('id, niche_id');
  const channelNiche = new Map((channels ?? []).map((c) => [c.id, c.niche_id]));

  // Load unattached videos with embeddings
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  let offset = 0;
  const BATCH = 500;
  let totalAttached = 0;
  let totalOrphans = 0;
  const attachedByNiche = new Map<string, number>();
  const orphansByNiche = new Map<string, number>();

  while (true) {
    const { data: videos } = await db
      .from('videos')
      .select('id, title, channel_id, title_embedding')
      .is('topic_id', null)
      .not('title_embedding', 'is', null)
      .gte('published_at', cutoff)
      .range(offset, offset + BATCH - 1);

    if (!videos?.length) break;

    for (const video of videos) {
      const videoEmb = parseEmbedding(video.title_embedding);
      if (videoEmb.length === 0) continue;

      const nicheId = channelNiche.get(video.channel_id);
      const nicheName = nicheId ? (nicheNames.get(nicheId) ?? 'Unknown') : 'Unknown';

      // Tiered matching: same-niche ≥ 0.68, then cross-niche ≥ 0.75
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

      const matched =
        (bestSameTopicId && bestSameSim >= SAME_NICHE_THRESHOLD) ? bestSameTopicId :
        (bestCrossTopicId && bestCrossSim >= CROSS_NICHE_THRESHOLD) ? bestCrossTopicId :
        null;

      if (matched) {
        if (!DRY_RUN) {
          await db.from('videos').update({ topic_id: matched }).eq('id', video.id);
        }
        totalAttached++;
        attachedByNiche.set(nicheName, (attachedByNiche.get(nicheName) ?? 0) + 1);
      } else {
        totalOrphans++;
        orphansByNiche.set(nicheName, (orphansByNiche.get(nicheName) ?? 0) + 1);
      }
    }

    offset += videos.length;
    console.log(`  Traité: ${offset} vidéos (${totalAttached} rattachées, ${totalOrphans} orphelines)`);
    if (videos.length < BATCH) break;
  }

  console.log('\n=== Répartition par niche ===');
  console.log('| Niche | Rattachées | Orphelines |');
  console.log('| --- | --- | --- |');
  for (const [name] of nicheNames) {
    const nName = nicheNames.get(name) ?? name;
    const attached = attachedByNiche.get(nName) ?? 0;
    const orphans = orphansByNiche.get(nName) ?? 0;
    console.log(`| ${nName} | ${attached} | ${orphans} |`);
  }
  console.log(`\nTotal: ${totalAttached} rattachées, ${totalOrphans} orphelines sur ${offset} vidéos`);

  if (DRY_RUN) {
    console.log('\n(DRY RUN — relancer avec --apply pour appliquer)');
  }

  await runner.finish(job.id, { quotaUsed: 0, itemsProcessed: totalAttached });
}

main().catch(console.error);
