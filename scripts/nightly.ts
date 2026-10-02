/**
 * Local nightly pipeline — runs collect → classify → score sequentially.
 * Usage: pnpm nightly
 *
 * Replaces Vercel crons while the app is not yet deployed.
 */
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
import { computeAllOutliers } from '../lib/scoring/outlier-service';
import { runClassify } from '../lib/nlp/classify-service';
import { VoyageEmbeddingProvider } from '../lib/providers/voyage-embeddings';
import { FakeEmbeddingProvider } from '../lib/providers/embeddings';
import { ConsoleAlertSender } from '../lib/email/resend-alerts';

const DEADLINE_MS = 15 * 60 * 1000; // 15 minutes

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey);
  const yt = new RealYouTubeClient();
  const deadline = Date.now() + DEADLINE_MS;
  const alertSender = new ConsoleAlertSender();
  const embedder = process.env.VOYAGE_API_KEY
    ? new VoyageEmbeddingProvider()
    : new FakeEmbeddingProvider();

  const start = Date.now();

  // ── Phase 1: COLLECT ─────────────────────────────────────────────
  console.log('\n========== COLLECT ==========');

  console.log('  Signals (Trends, HN, SE)...');
  const signals = await collectSignals(db, deadline);
  console.log(`    Trend: ${signals.trendPointsCollected}, Social: ${signals.socialPointsCollected}, YT: ${signals.ytViewPointsCollected}`);

  console.log('  Videos & snapshots...');
  const collect = await runCollect(db, yt, deadline);
  console.log(`    Channels: ${collect.channelsUpdated}, Videos: ${collect.videosDiscovered} (RSS: ${collect.videosFromRSS}, API: ${collect.videosFromAPI})`);
  console.log(`    Snapshots: ${collect.snapshotsTaken}, Comments: ${collect.commentsImported}`);
  console.log(`    Quota: ${collect.quotaUsed}`);

  console.log('  Clustering...');
  const clustering = await runClustering(db, embedder, deadline);
  console.log(`    Embedded: ${clustering.videosEmbedded}, Attached: ${clustering.videosAttached}, Proposed: ${clustering.topicsProposed}`);

  console.log('  YouTube search...');
  const search = await runYouTubeSearch(db, deadline, collect.quotaUsed);
  console.log(`    Searches: ${search.searchesPerformed}, Discovered: ${search.videosDiscovered}`);

  // ── Phase 2: CLASSIFY ────────────────────────────────────────────
  console.log('\n========== CLASSIFY ==========');
  if (process.env.ANTHROPIC_API_KEY) {
    const classify = await runClassify(db, deadline);
    console.log(`  Submitted: ${classify.commentsSubmitted}, Labels: ${classify.labelsStored}`);
    console.log(`  Batches: submitted=${classify.batchSubmitted}, retrieved=${classify.batchesRetrieved}`);
  } else {
    console.log('  ANTHROPIC_API_KEY not set — skipped');
  }

  // ── Phase 3: SCORE ───────────────────────────────────────────────
  console.log('\n========== SCORE ==========');
  const score = await runScore(db, alertSender);
  console.log(`  Topics scored: ${score.topicsScored}`);
  console.log(`  Burn-down alerts: ${score.burnDownAlerts}`);
  if (score.silentCollectionAlert) console.log('  Silent collection alert triggered');

  console.log('  Outliers...');
  try {
    const outliers = await computeAllOutliers(db);
    console.log(`    Computed: ${outliers.computed}, Skipped: ${outliers.skipped}`);
  } catch (err) {
    console.error(`    Failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── Summary ──────────────────────────────────────────────────────
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\n========== DONE in ${elapsed}s ==========`);
  console.log(`  YouTube quota: ${yt.getQuotaUsed()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
