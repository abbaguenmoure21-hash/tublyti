import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

import { RealYouTubeClient } from '../lib/youtube/client';
import { runCollect } from '../lib/youtube/collect';
import { collectSignals } from '../lib/signals/collect-signals';
import { runClustering } from '../lib/topics/cluster-service';
import { runYouTubeSearch } from '../lib/youtube/search';
import { runScore } from '../lib/scoring/score-service';
import { runClassify } from '../lib/nlp/classify-service';
import { extractTitlePatterns } from '../lib/nlp/title-patterns';
import { VoyageEmbeddingProvider } from '../lib/providers/voyage-embeddings';
import { FakeEmbeddingProvider } from '../lib/providers/embeddings';
import { ConsoleAlertSender } from '../lib/email/resend-alerts';

const DEADLINE_MS = 10 * 60 * 1000; // 10 minutes
const args = process.argv.slice(2);
const SKIP_COLLECT = args.includes('--skip-collect');
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1];

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey);
  const deadline = Date.now() + DEADLINE_MS;
  const alertSender = new ConsoleAlertSender();

  // ── Step 1: Apply pending RPM migration if needed ──────────────
  console.log('=== Checking RPM columns ===');
  const { error: rpmCheck } = await db.from('niches').select('rpm_low').limit(1);
  if (rpmCheck?.message?.includes('rpm_low')) {
    console.log('  Applying RPM migration...');
    await db.rpc('exec_sql', {
      sql: `
        alter table niches add column if not exists rpm_low numeric;
        alter table niches add column if not exists rpm_high numeric;
        alter table niches add column if not exists rpm_source text;
      `,
    }).then(() => console.log('  Done.')).catch(() => {
      console.log('  RPC exec_sql not available — run migration 00004 manually via Supabase dashboard.');
    });
  } else {
    console.log('  RPM columns present.');
  }

  // Update RPM data from seeds
  const rpmData: Record<string, { rpm_low: number; rpm_high: number; rpm_source: string }> = {
    'Personal Finance & Investing': { rpm_low: 8, rpm_high: 25, rpm_source: 'Influencer Marketing Hub 2024' },
    'Psychology & Self-Improvement': { rpm_low: 4, rpm_high: 12, rpm_source: 'Influencer Marketing Hub 2024' },
    'AI Tools & Automation': { rpm_low: 6, rpm_high: 20, rpm_source: 'Influencer Marketing Hub 2024' },
  };
  for (const [name, rpm] of Object.entries(rpmData)) {
    const { error } = await db.from('niches').update(rpm).eq('name', name);
    if (!error) console.log(`  RPM set for ${name}: $${rpm.rpm_low}–$${rpm.rpm_high}`);
  }

  const shouldRun = (step: string) => !ONLY || ONLY.split(',').includes(step);

  const yt = new RealYouTubeClient();
  let quotaUsed = 0;

  // ── Step 2: Collect videos from all channels ───────────────────
  if (!SKIP_COLLECT && shouldRun('collect')) {
    console.log('\n=== Collect (videos, comments, snapshots) ===');
    const collectResult = await runCollect(db, yt, deadline);
    quotaUsed = collectResult.quotaUsed;
    console.log(`  Channels: ${collectResult.channelsUpdated}`);
    console.log(`  Videos discovered: ${collectResult.videosDiscovered}`);
    console.log(`  Snapshots: ${collectResult.snapshotsTaken}`);
    console.log(`  Comments imported: ${collectResult.commentsImported}`);
    console.log(`  Quota used: ${quotaUsed}`);
    if (collectResult.stoppedByQuota) console.log('  ⚠ Stopped by quota limit');
    if (collectResult.stoppedByTimeout) console.log('  ⚠ Stopped by timeout');
  } else {
    console.log('\n=== Collect: SKIPPED ===');
  }

  // ── Step 3: Collect signals (Trends, HN, SE, YouTube views) ────
  if (shouldRun('signals') && Date.now() < deadline) {
    console.log('\n=== Signals (Trends, Social, YT views) ===');
    const signals = await collectSignals(db, deadline);
    console.log(`  Trend points: ${signals.trendPointsCollected}`);
    console.log(`  Social points: ${signals.socialPointsCollected}`);
    console.log(`  YT view points: ${signals.ytViewPointsCollected}`);
  }

  // ── Step 4: Embed & cluster videos into topics ──────────────────
  if (shouldRun('cluster') && Date.now() < deadline) {
    console.log('\n=== Clustering (embeddings + topic assignment) ===');
    const embedder = process.env.VOYAGE_API_KEY
      ? new VoyageEmbeddingProvider()
      : new FakeEmbeddingProvider();
    const clustering = await runClustering(db, embedder, deadline);
    console.log(`  Videos embedded: ${clustering.videosEmbedded}`);
    console.log(`  Videos attached to topics: ${clustering.videosAttached}`);
    console.log(`  Topics proposed: ${clustering.topicsProposed}`);
  }

  // ── Step 5: YouTube Search (discover videos outside channels) ──
  if (shouldRun('search') && Date.now() < deadline) {
    console.log('\n=== YouTube Search ===');
    const search = await runYouTubeSearch(db, deadline, quotaUsed);
    console.log(`  Searches: ${search.searchesPerformed}`);
    console.log(`  Videos discovered: ${search.videosDiscovered}`);
  }

  // ── Step 6: Score all topics ────────────────────────────────────
  if (shouldRun('score')) {
    console.log('\n=== Scoring (MGI + phase + feasibility) ===');
    const scoreResult = await runScore(db, alertSender);
    console.log(`  Topics scored: ${scoreResult.topicsScored}`);
  }

  // ── Step 7: Classify comments (Anthropic Batch API) ─────────────
  if (shouldRun('classify') && process.env.ANTHROPIC_API_KEY) {
    console.log('\n=== Classify comments (Anthropic Batch API) ===');
    const classifyResult = await runClassify(db, deadline);
    console.log(`  Comments submitted: ${classifyResult.commentsSubmitted}`);
    console.log(`  Labels stored: ${classifyResult.labelsStored}`);
    console.log(`  Batches: pending=${classifyResult.batchesPending}, retrieved=${classifyResult.batchesRetrieved}`);

    // Title patterns
    if (shouldRun('patterns')) {
      console.log('\n=== Title Patterns ===');
      try {
        const patterns = await extractTitlePatterns(db);
        console.log(`  Patterns stored: ${patterns.patternsStored}`);
        console.log(`  Niches processed: ${patterns.nichesProcessed}`);
      } catch (err) {
        console.error(`  Title patterns failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } else if (shouldRun('classify')) {
    console.log('\n⚠ ANTHROPIC_API_KEY not set — skipping classify + title patterns');
  }

  // ── Summary ─────────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  const { count: channelCount } = await db.from('channels').select('*', { count: 'exact', head: true });
  const { count: videoCount } = await db.from('videos').select('*', { count: 'exact', head: true });
  const { count: topicCount } = await db.from('topics').select('*', { count: 'exact', head: true });
  const { count: commentCount } = await db.from('comments').select('*', { count: 'exact', head: true });
  const { count: scoreCount } = await db.from('topic_scores').select('*', { count: 'exact', head: true });

  console.log(`  Channels: ${channelCount}`);
  console.log(`  Videos: ${videoCount}`);
  console.log(`  Topics: ${topicCount}`);
  console.log(`  Comments: ${commentCount}`);
  console.log(`  Scores: ${scoreCount}`);
  console.log(`\nTotal YouTube quota: ${yt.getQuotaUsed()}`);
  console.log(`Duration: ${((Date.now() - (deadline - DEADLINE_MS)) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
