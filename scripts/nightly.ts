/**
 * Local nightly pipeline.
 * Order: collect → embed → attach → discover-topics → quality-gates → search → embed+attach (pass 2) → classify → score.
 * Each step sees data from the previous step.
 *
 * Usage: pnpm nightly
 * Each step writes a job record (start/finish) for traceability.
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
import { runEmbedAll } from '../lib/topics/embed-service';
import { runAttachAll } from '../lib/topics/attach-service';
import { runClustering } from '../lib/topics/cluster-service';
import { runYouTubeSearch } from '../lib/youtube/search';
import { runScore } from '../lib/scoring/score-service';
import { computeAllOutliers } from '../lib/scoring/outlier-service';
import { runClassify } from '../lib/nlp/classify-service';
import { VoyageEmbeddingProvider } from '../lib/providers/voyage-embeddings';
import { FakeEmbeddingProvider } from '../lib/providers/embeddings';
import { runQualityGates } from '../lib/topics/quality-gates';
import { ConsoleAlertSender } from '../lib/email/resend-alerts';
import { SupabaseJobRunner } from '../lib/jobs/supabase-runner';

const DEADLINE_MS = 15 * 60 * 1000; // 15 minutes

async function runStep(
  runner: SupabaseJobRunner,
  kind: string,
  fn: () => Promise<{ quota: number; items: number }>,
): Promise<void> {
  const job = await runner.start(kind);
  try {
    const result = await fn();
    await runner.finish(job.id, {
      quotaUsed: result.quota,
      itemsProcessed: result.items,
    });
  } catch (err) {
    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: 0,
      error: err instanceof Error ? err.message : String(err),
    });
    console.error(`  [${kind}] ERROR: ${err instanceof Error ? err.message : err}`);
  }
}

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
  const runner = new SupabaseJobRunner(db);
  runner.setAlertSender(alertSender);
  const embedder = process.env.VOYAGE_API_KEY
    ? new VoyageEmbeddingProvider()
    : new FakeEmbeddingProvider();

  const start = Date.now();

  // ── Step 1: COLLECT (signals + videos + snapshots + comments) ────
  console.log('\n========== COLLECT ==========');

  await runStep(runner, 'collect', async () => {
    console.log('  Signals (Trends, HN, SE)...');
    const signals = await collectSignals(db, deadline);
    console.log(`    Trend: ${signals.trendPointsCollected}, Social: ${signals.socialPointsCollected}, YT: ${signals.ytViewPointsCollected}`);

    console.log('  Videos & snapshots...');
    const collect = await runCollect(db, yt, deadline);
    console.log(`    Channels: ${collect.channelsUpdated}, Videos: ${collect.videosDiscovered} (RSS: ${collect.videosFromRSS}, API: ${collect.videosFromAPI})`);
    console.log(`    Snapshots: ${collect.snapshotsTaken}, Comments: ${collect.commentsImported}`);
    console.log(`    Quota: ${collect.quotaUsed}`);

    return {
      quota: collect.quotaUsed,
      items: collect.videosDiscovered + collect.snapshotsTaken + collect.commentsImported,
    };
  });

  // ── Step 2: EMBED (all unembedded video titles) ────────────────
  console.log('\n========== EMBED ==========');

  await runStep(runner, 'embed', async () => {
    const { embedded } = await runEmbedAll(db, embedder, deadline);
    console.log(`  Embedded: ${embedded} videos`);
    return { quota: 0, items: embedded };
  });

  // ── Step 3: ATTACH (all unattached videos → topics) ───────────
  console.log('\n========== ATTACH ==========');

  await runStep(runner, 'attach', async () => {
    const { attached, orphans } = await runAttachAll(db, deadline);
    console.log(`  Attached: ${attached}, Orphans: ${orphans}`);
    return { quota: 0, items: attached };
  });

  // ── Step 4: DISCOVER-TOPICS (cluster orphans into new topics) ──
  console.log('\n========== DISCOVER-TOPICS ==========');

  await runStep(runner, 'discover-topics', async () => {
    const clustering = await runClustering(db, embedder, deadline);
    console.log(`  Proposed: ${clustering.topicsProposed}`);
    return { quota: 0, items: clustering.topicsProposed };
  });

  // ── Step 5: QUALITY-GATES (reject single-channel-dominated topics) ──
  console.log('\n========== QUALITY-GATES ==========');

  await runStep(runner, 'quality-gates', async () => {
    const gates = await runQualityGates(db);
    console.log(`  Rejected (mono-channel): ${gates.rejectedMonoChannel}`);
    console.log(`  Rejected (channel-name): ${gates.rejectedChannelName}`);
    console.log(`  Sensitive flagged: ${gates.sensitiveFlagged}`);
    return { quota: 0, items: gates.rejectedMonoChannel + gates.rejectedChannelName };
  });

  // ── Step 6: SEARCH ──────────────────────────────────────────────
  console.log('\n========== SEARCH ==========');

  await runStep(runner, 'search', async () => {
    const search = await runYouTubeSearch(db, deadline, yt.getQuotaUsed());
    console.log(`  Searches: ${search.searchesPerformed}, Discovered: ${search.videosDiscovered}`);
    return { quota: 0, items: search.videosDiscovered };
  });

  // ── Step 7: EMBED-2 + ATTACH-2 (new videos from search) ───────
  console.log('\n========== EMBED+ATTACH (pass 2) ==========');

  await runStep(runner, 'embed-pass2', async () => {
    const { embedded } = await runEmbedAll(db, embedder, deadline);
    const { attached, orphans } = await runAttachAll(db, deadline);
    console.log(`  Embedded: ${embedded}, Attached: ${attached}, Orphans: ${orphans}`);
    return { quota: 0, items: embedded + attached };
  });

  // ── Step 8: CLASSIFY (retrieve pending batches + submit new) ────
  console.log('\n========== CLASSIFY ==========');

  if (process.env.ANTHROPIC_API_KEY) {
    await runStep(runner, 'classify', async () => {
      const classify = await runClassify(db, deadline);
      console.log(`  Submitted: ${classify.commentsSubmitted}, Labels: ${classify.labelsStored}`);
      console.log(`  Batches: submitted=${classify.batchSubmitted}, retrieved=${classify.batchesRetrieved}`);
      return { quota: 0, items: classify.labelsStored };
    });
  } else {
    console.log('  ANTHROPIC_API_KEY not set — skipped');
  }

  // ── Step 9: SCORE (MGI + phase + outliers) ─────────────────────
  console.log('\n========== SCORE ==========');

  await runStep(runner, 'score', async () => {
    const score = await runScore(db, alertSender);
    console.log(`  Topics scored: ${score.topicsScored}`);
    console.log(`  Burn-down alerts: ${score.burnDownAlerts}`);
    if (score.silentCollectionAlert) console.log('  Silent collection alert triggered');

    let outlierCount = 0;
    try {
      const outliers = await computeAllOutliers(db);
      console.log(`  Outliers: ${outliers.computed} computed, ${outliers.skipped} skipped`);
      outlierCount = outliers.computed;
    } catch (err) {
      console.error(`  Outliers failed: ${err instanceof Error ? err.message : err}`);
    }

    return { quota: 0, items: score.topicsScored + outlierCount };
  });

  // ── Summary ────────────────────────────────────────────────────
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`\n========== DONE in ${elapsed}s ==========`);
  console.log(`  YouTube quota: ${yt.getQuotaUsed()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
