/**
 * Discover topics from:
 *   1. Outlier videos (views >= 3x channel median) — priority
 *   2. Broad clustering of all unattached embedded videos — fallback
 *
 * Target: >= 30 proposed topics per niche.
 * Groups by embedding similarity, names clusters via Haiku.
 *
 * Usage:
 *   npx tsx scripts/discover-topics.ts --dry-run    # show what would be created (default)
 *   npx tsx scripts/discover-topics.ts --apply       # create the topics
 *   npx tsx scripts/discover-topics.ts --estimate    # just show cost estimate
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';

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

import { SupabaseJobRunner } from '../lib/jobs/supabase-runner';

const DRY_RUN = !process.argv.includes('--apply');
const ESTIMATE_ONLY = process.argv.includes('--estimate');
const thresholdArg = process.argv.find(a => a.startsWith('--threshold='));
const CLUSTER_THRESHOLD = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : 0.78;
const MIN_CLUSTER_SIZE = 2;
const OUTLIER_RATIO = 3;
const TARGET_TOPICS_PER_NICHE = 30;

// ── Helpers ──────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
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

interface EmbeddedVideo {
  id: string;
  title: string;
  channelId: string;
  embedding: number[];
  views: number;
  isOutlier: boolean;
}

interface Cluster {
  videos: EmbeddedVideo[];
  centroid: number[];
}

// ── Greedy clustering ────────────────────────────────────────────────

function greedyCluster(items: EmbeddedVideo[], threshold: number, minSize: number): Cluster[] {
  // Sort outliers first so they seed clusters
  const sorted = [...items].sort((a, b) => (b.isOutlier ? 1 : 0) - (a.isOutlier ? 1 : 0) || b.views - a.views);
  const used = new Set<number>();
  const clusters: Cluster[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const cluster = [sorted[i]];
    used.add(i);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const sim = cosineSimilarity(sorted[i].embedding, sorted[j].embedding);
      if (sim >= threshold) {
        cluster.push(sorted[j]);
        used.add(j);
      }
    }

    if (cluster.length >= minSize) {
      clusters.push({
        videos: cluster,
        centroid: averageEmbedding(cluster.map((v) => v.embedding)),
      });
    }
  }

  return clusters;
}

// ── Filter against existing topics ──────────────────────────────────

async function filterNewClusters(
  db: SupabaseClient,
  clusters: Cluster[],
  nicheId: string,
): Promise<Cluster[]> {
  const { data: existingTopics } = await db
    .from('topics')
    .select('id, embedding')
    .eq('niche_id', nicheId)
    .not('embedding', 'is', null)
    .in('status', ['proposed', 'active', 'in_production']);

  const topicEmbeddings = (existingTopics ?? [])
    .map((t) => parseEmbedding(t.embedding))
    .filter((e) => e.length > 0);

  return clusters.filter((cluster) => {
    for (const topicEmb of topicEmbeddings) {
      const sim = cosineSimilarity(cluster.centroid, topicEmb);
      if (sim >= 0.82) return false;
    }
    return true;
  });
}

// ── Name cluster via Haiku ───────────────────────────────────────────

interface TopicNaming {
  label: string;
  queries: string[];
}

async function nameCluster(titles: string[], nicheName: string): Promise<TopicNaming | null> {
  const anthropic = new Anthropic();
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are classifying YouTube video clusters for the "${nicheName}" niche.

Given these video titles from a cluster:
${titles.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')}

1. If these videos are NOT about the "${nicheName}" niche, respond with: {"reject": true}
2. Otherwise, respond with a JSON object:
{
  "label": "2-6 word English topic name (lowercase, no articles)",
  "queries": ["search query 1", "search query 2", "search query 3"]
}

The label should capture the shared theme. The queries should be YouTube search terms. Respond ONLY with valid JSON, no markdown.`,
      }],
    });

    let text = response.content[0].type === 'text' ? response.content[0].text : '';
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
    console.error(`    Haiku error: ${(err as Error).message}`);
    return null;
  }
}

// ── Load unattached videos per niche ─────────────────────────────────

async function loadNicheVideos(
  db: SupabaseClient,
  nicheId: string,
): Promise<EmbeddedVideo[]> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: channels } = await db
    .from('channels')
    .select('id')
    .eq('niche_id', nicheId)
    .eq('status', 'active');

  if (!channels?.length) return [];

  const allVideos: EmbeddedVideo[] = [];
  const channelIds = channels.map((c) => c.id);

  for (let ci = 0; ci < channelIds.length; ci += 50) {
    const chunk = channelIds.slice(ci, ci + 50);

    const { data: videos } = await db
      .from('videos')
      .select('id, title, channel_id, title_embedding')
      .in('channel_id', chunk)
      .is('topic_id', null)
      .not('title_embedding', 'is', null)
      .not('title', 'is', null)
      .gte('published_at', cutoff);

    if (!videos?.length) continue;

    // Get latest snapshot views
    const videoIds = videos.map((v) => v.id);
    const { data: snapshots } = await db
      .from('video_snapshots')
      .select('video_id, views')
      .in('video_id', videoIds)
      .order('captured_at', { ascending: false });

    const latestViews = new Map<string, number>();
    for (const s of snapshots ?? []) {
      if (!latestViews.has(s.video_id)) latestViews.set(s.video_id, Number(s.views ?? 0));
    }

    // Compute channel medians
    const channelViewsList = new Map<string, number[]>();
    for (const v of videos) {
      const views = latestViews.get(v.id) ?? 0;
      if (!channelViewsList.has(v.channel_id)) channelViewsList.set(v.channel_id, []);
      channelViewsList.get(v.channel_id)!.push(views);
    }
    const channelMedian = new Map<string, number>();
    for (const [chId, viewsList] of channelViewsList) {
      const sorted = viewsList.sort((a, b) => a - b);
      channelMedian.set(chId, sorted[Math.floor(sorted.length / 2)]);
    }

    for (const v of videos) {
      const emb = parseEmbedding(v.title_embedding);
      if (emb.length === 0) continue;
      const views = latestViews.get(v.id) ?? 0;
      const median = channelMedian.get(v.channel_id) ?? 1;
      const isOutlier = median > 0 && views >= OUTLIER_RATIO * median;

      allVideos.push({
        id: v.id,
        title: v.title,
        channelId: v.channel_id,
        embedding: emb,
        views,
        isOutlier,
      });
    }
  }

  return allVideos;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(`\n=== Découverte de sujets ${ESTIMATE_ONLY ? '(ESTIMATION)' : DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===\n`);

  const { data: niches } = await db.from('niches').select('id, name');

  // Count existing proposed topics per niche
  const existingTopicCounts = new Map<string, number>();
  for (const niche of niches ?? []) {
    const { count } = await db
      .from('topics')
      .select('id', { count: 'exact', head: true })
      .eq('niche_id', niche.id)
      .in('status', ['proposed', 'active', 'in_production']);
    existingTopicCounts.set(niche.id, count ?? 0);
  }

  let totalNewClusters = 0;
  let totalCreated = 0;
  const nicheResults: { name: string; videos: number; outliers: number; clusters: number; newClusters: number; existing: number }[] = [];

  for (const niche of niches ?? []) {
    console.log(`\n--- ${niche.name} ---`);
    const existing = existingTopicCounts.get(niche.id) ?? 0;
    console.log(`  Sujets existants: ${existing}`);

    const videos = await loadNicheVideos(db, niche.id);
    const outlierCount = videos.filter((v) => v.isOutlier).length;
    console.log(`  Vidéos avec embedding (sans topic): ${videos.length}, dont outliers: ${outlierCount}`);

    if (videos.length < MIN_CLUSTER_SIZE) {
      nicheResults.push({ name: niche.name, videos: videos.length, outliers: outlierCount, clusters: 0, newClusters: 0, existing });
      continue;
    }

    // Cluster all videos (outliers seed the clusters first)
    const clusters = greedyCluster(videos, CLUSTER_THRESHOLD, MIN_CLUSTER_SIZE);
    console.log(`  Clusters formés: ${clusters.length}`);

    // Filter against existing topics
    const newClusters = await filterNewClusters(db, clusters, niche.id);
    console.log(`  Nouveaux clusters (après dédup): ${newClusters.length}`);

    nicheResults.push({
      name: niche.name,
      videos: videos.length,
      outliers: outlierCount,
      clusters: clusters.length,
      newClusters: newClusters.length,
      existing,
    });
    totalNewClusters += newClusters.length;

    if (!ESTIMATE_ONLY) {
      for (const cluster of newClusters) {
        const titles = cluster.videos.map((v) => v.title);
        const hasOutlier = cluster.videos.some((v) => v.isOutlier);
        const tag = hasOutlier ? '[OUTLIER]' : '[BROAD]';

        if (DRY_RUN) {
          console.log(`  ${tag} Cluster (${cluster.videos.length} vidéos):`);
          for (const v of cluster.videos.slice(0, 5)) {
            console.log(`    - ${v.title} (${v.views.toLocaleString()} vues${v.isOutlier ? ' *' : ''})`);
          }
          if (cluster.videos.length > 5) console.log(`    ... et ${cluster.videos.length - 5} autres`);
        } else {
          const named = await nameCluster(titles, niche.name);
          if (!named) {
            console.log(`  ${tag} Rejeté par Haiku (hors niche)`);
            continue;
          }

          const { data: newTopic, error: topicErr } = await db
            .from('topics')
            .insert({
              workspace_id: '00000000-0000-0000-0000-000000000001',
              niche_id: niche.id,
              label: named.label,
              embedding: formatVector(cluster.centroid),
              status: 'proposed',
            })
            .select('id')
            .single();

          if (topicErr) {
            console.error(`  ${tag} Erreur: ${topicErr.message}`);
            continue;
          }

          const videoIds = cluster.videos.map((v) => v.id);
          await db.from('videos').update({ topic_id: newTopic.id }).in('id', videoIds);

          for (const q of named.queries) {
            await db.from('topic_queries').insert({
              workspace_id: '00000000-0000-0000-0000-000000000001',
              topic_id: newTopic.id,
              source: 'youtube',
              query_text: q,
              priority: 1,
            });
          }

          totalCreated++;
          console.log(`  ${tag} Créé: "${named.label}" (${videoIds.length} vidéos)`);
        }
      }
    }
  }

  // Cost estimate
  const haikuInputTokens = totalNewClusters * 300;
  const haikuOutputTokens = totalNewClusters * 80;
  const haikuCost = (haikuInputTokens / 1_000_000) * 0.80 + (haikuOutputTokens / 1_000_000) * 4.00;

  console.log('\n=== Résumé ===');
  console.log('| Niche | Vidéos | Outliers | Clusters | Nouveaux | Existants |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const r of nicheResults) {
    console.log(`| ${r.name} | ${r.videos} | ${r.outliers} | ${r.clusters} | ${r.newClusters} | ${r.existing} |`);
  }
  console.log(`\nTotal nouveaux clusters: ${totalNewClusters}`);
  console.log(`Coût Haiku estimé: $${haikuCost.toFixed(4)} (${haikuInputTokens} input + ${haikuOutputTokens} output tokens)`);

  if (!ESTIMATE_ONLY && !DRY_RUN) {
    console.log(`\nSujets créés: ${totalCreated}`);
  } else if (DRY_RUN && !ESTIMATE_ONLY) {
    console.log('\n(DRY RUN — relancer avec --apply pour créer)');
  } else {
    console.log('\n(Mode estimation — rien créé)');
  }
}

main().catch(console.error);
