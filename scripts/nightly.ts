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
import { discoverChannels, retrieveDiscoveryBatches } from '../lib/youtube/discover-channels';
import { runDiscoverySources } from '../lib/youtube/discover-sources';
import { autoTriageCandidates } from '../lib/youtube/auto-triage';
import { ResendAlertSender, ConsoleAlertSender } from '../lib/email/resend-alerts';
import { SupabaseJobRunner } from '../lib/jobs/supabase-runner';

const DEADLINE_MS = parseInt(process.env.NIGHTLY_DEADLINE_MIN ?? '15', 10) * 60 * 1000;

async function runStep(
  runner: SupabaseJobRunner,
  deadline: number,
  kind: string,
  fn: () => Promise<{ quota: number; items: number }>,
): Promise<void> {
  if (Date.now() >= deadline) {
    console.log(`  [${kind}] SKIPPED — deadline reached`);
    const job = await runner.start(kind);
    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: 0,
      error: 'skipped: deadline reached',
    });
    return;
  }
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
  const alertSender = process.env.RESEND_API_KEY && process.env.ALERT_EMAIL
    ? new ResendAlertSender()
    : new ConsoleAlertSender();
  const runner = new SupabaseJobRunner(db);
  runner.setAlertSender(alertSender);
  const embedder = process.env.VOYAGE_API_KEY
    ? new VoyageEmbeddingProvider()
    : new FakeEmbeddingProvider();

  const start = Date.now();

  // ── Per-group time budgets ──────────────────────────────────────
  // collect 40%, embed+attach 15%, discover+triage 15%, classify 15%, score+aggregate gets the rest
  const collectEnd     = start + DEADLINE_MS * 0.40;
  const embedAttachEnd = start + DEADLINE_MS * 0.55;
  const discoverEnd    = start + DEADLINE_MS * 0.70;
  const classifyEnd    = start + DEADLINE_MS * 0.85;
  // score uses global deadline — it always runs

  console.log(`  Time budgets: collect ${Math.round(DEADLINE_MS * 0.40 / 60000)}min, embed+attach ${Math.round(DEADLINE_MS * 0.15 / 60000)}min, discover ${Math.round(DEADLINE_MS * 0.15 / 60000)}min, classify ${Math.round(DEADLINE_MS * 0.15 / 60000)}min, score+agg rest`);

  // ── Step 1: COLLECT (signals + videos + snapshots + comments) ────
  console.log('\n========== COLLECT ==========');

  await runStep(runner, collectEnd, 'collect', async () => {
    console.log('  Signals (Trends, HN, SE)...');
    const signals = await collectSignals(db, collectEnd);
    console.log(`    Trend: ${signals.trendPointsCollected}, Social: ${signals.socialPointsCollected}, YT: ${signals.ytViewPointsCollected}`);

    console.log('  Videos & snapshots...');
    const collect = await runCollect(db, yt, collectEnd);
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

  await runStep(runner, embedAttachEnd, 'embed', async () => {
    const { embedded } = await runEmbedAll(db, embedder, embedAttachEnd);
    console.log(`  Embedded: ${embedded} videos`);
    return { quota: 0, items: embedded };
  });

  // ── Step 3: ATTACH (all unattached videos → topics) ───────────
  console.log('\n========== ATTACH ==========');

  await runStep(runner, embedAttachEnd, 'attach', async () => {
    const { attached, orphans } = await runAttachAll(db, embedAttachEnd);
    console.log(`  Attached: ${attached}, Orphans: ${orphans}`);
    return { quota: 0, items: attached };
  });

  // ── Step 4: DISCOVER-TOPICS (cluster orphans into new topics) ──
  console.log('\n========== DISCOVER-TOPICS ==========');

  await runStep(runner, discoverEnd, 'discover-topics', async () => {
    const clustering = await runClustering(db, embedder, discoverEnd);
    console.log(`  Proposed: ${clustering.topicsProposed}`);
    return { quota: 0, items: clustering.topicsProposed };
  });

  // ── Step 5: QUALITY-GATES (reject single-channel-dominated topics) ──
  console.log('\n========== QUALITY-GATES ==========');

  await runStep(runner, discoverEnd, 'quality-gates', async () => {
    const gates = await runQualityGates(db);
    console.log(`  Rejected (mono-channel): ${gates.rejectedMonoChannel}`);
    console.log(`  Rejected (channel-name): ${gates.rejectedChannelName}`);
    console.log(`  Sensitive flagged: ${gates.sensitiveFlagged}`);
    return { quota: 0, items: gates.rejectedMonoChannel + gates.rejectedChannelName };
  });

  // ── Step 6: SEARCH ──────────────────────────────────────────────
  console.log('\n========== SEARCH ==========');

  await runStep(runner, discoverEnd, 'search', async () => {
    const search = await runYouTubeSearch(db, discoverEnd, yt.getQuotaUsed());
    console.log(`  Searches: ${search.searchesPerformed}, Discovered: ${search.videosDiscovered}`);
    return { quota: 0, items: search.videosDiscovered };
  });

  // ── Step 7: DISCOVER-SOURCES (channelSections + search results) ─
  console.log('\n========== DISCOVER-SOURCES ==========');

  await runStep(runner, discoverEnd, 'discover-sources', async () => {
    const sources = await runDiscoverySources(db, discoverEnd, 500);
    console.log(`  channelSections: ${sources.channelSections.channelsDiscovered} channels (${sources.channelSections.quotaUsed} quota)`);
    console.log(`  searchResults: ${sources.searchResults.channelsDiscovered} channels`);
    const totalQuota = sources.channelSections.quotaUsed;
    const totalChannels = sources.channelSections.channelsDiscovered + sources.searchResults.channelsDiscovered;
    return { quota: totalQuota, items: totalChannels };
  });

  // ── Step 8: DISCOVER-CHANNELS (search for new channels in phase 1/2 topics) ─
  console.log('\n========== DISCOVER-CHANNELS ==========');

  await runStep(runner, discoverEnd, 'discover-channels', async () => {
    const disc = await discoverChannels(db, discoverEnd, yt.getQuotaUsed());
    console.log(`  Searches: ${disc.searchesPerformed}, Channels: ${disc.channelsDiscovered}`);
    console.log(`  Faceless estimated: ${disc.facelessEstimated} ($${disc.estimatedCostUSD.toFixed(3)})`);
    if (disc.stoppedByQuota) console.log('  Stopped by quota');
    if (disc.stoppedByTimeout) console.log('  Stopped by timeout');

    // Retrieve any pending faceless batch results
    const batchUpdated = await retrieveDiscoveryBatches(db);
    if (batchUpdated > 0) console.log(`  Faceless batches updated: ${batchUpdated}`);

    return { quota: 0, items: disc.channelsDiscovered };
  });

  // ── Step 9: AUTO-TRIAGE (enrich + classify pending candidates) ─
  console.log('\n========== AUTO-TRIAGE ==========');

  await runStep(runner, discoverEnd, 'auto-triage', async () => {
    const triage = await autoTriageCandidates(db, embedder);
    console.log(`  Processed: ${triage.processed}, Accepted: ${triage.accepted}, Rejected: ${triage.rejected}, Manual: ${triage.manual}`);
    console.log(`  Enriched: ${triage.enriched}, Promoted: ${triage.promoted}`);
    return { quota: triage.quotaUsed, items: triage.processed };
  });

  // ── Step 10: EMBED-2 + ATTACH-2 (new videos from search) ──────
  console.log('\n========== EMBED+ATTACH (pass 2) ==========');

  await runStep(runner, discoverEnd, 'embed-pass2', async () => {
    const { embedded } = await runEmbedAll(db, embedder, discoverEnd);
    const { attached, orphans } = await runAttachAll(db, discoverEnd);
    console.log(`  Embedded: ${embedded}, Attached: ${attached}, Orphans: ${orphans}`);
    return { quota: 0, items: embedded + attached };
  });

  // ── Step 11: CLASSIFY (retrieve pending batches + submit new) ───
  console.log('\n========== CLASSIFY ==========');

  if (process.env.ANTHROPIC_API_KEY) {
    await runStep(runner, classifyEnd, 'classify', async () => {
      const classify = await runClassify(db, classifyEnd);
      console.log(`  Submitted: ${classify.commentsSubmitted}, Labels: ${classify.labelsStored}`);
      console.log(`  Batches: submitted=${classify.batchSubmitted}, retrieved=${classify.batchesRetrieved}`);
      return { quota: 0, items: classify.labelsStored };
    });
  } else {
    console.log('  ANTHROPIC_API_KEY not set — skipped');
  }

  // ── Step 12: SCORE (MGI + phase + outliers) ────────────────────
  console.log('\n========== SCORE ==========');

  await runStep(runner, deadline, 'score', async () => {
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

  // ── Step 13: AGGREGATE (compress old snapshots into weekly) ────
  console.log('\n========== AGGREGATE ==========');

  await runStep(runner, deadline, 'aggregate', async () => {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    let aggregated = 0;
    let deleted = 0;

    while (true) {
      if (Date.now() >= deadline) break;
      const { data: snaps } = await db
        .from('video_snapshots')
        .select('id, video_id, views, likes, comments, captured_at')
        .lt('captured_at', cutoff)
        .order('captured_at', { ascending: true })
        .limit(500);

      if (!snaps?.length) break;

      const weeklyMap = new Map<string, { video_id: string; week_start: string; views: number; likes: number; comments: number; count: number }>();
      const ids: number[] = [];

      for (const s of snaps) {
        const d = new Date(s.captured_at);
        const day = d.getUTCDay();
        const mon = new Date(d);
        mon.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
        const ws = mon.toISOString().slice(0, 10);
        const key = `${s.video_id}::${ws}`;
        const ex = weeklyMap.get(key);
        if (ex) {
          ex.views = Math.max(ex.views, s.views ?? 0);
          ex.likes = Math.max(ex.likes, s.likes ?? 0);
          ex.comments = Math.max(ex.comments, s.comments ?? 0);
          ex.count++;
        } else {
          weeklyMap.set(key, { video_id: s.video_id, week_start: ws, views: s.views ?? 0, likes: s.likes ?? 0, comments: s.comments ?? 0, count: 1 });
        }
        ids.push(s.id);
      }

      for (const e of weeklyMap.values()) {
        await db.from('video_stats_weekly').upsert({
          video_id: e.video_id, week_start: e.week_start,
          views: e.views, likes: e.likes, comments: e.comments, snapshots_count: e.count,
        }, { onConflict: 'video_id,week_start' });
      }

      for (let i = 0; i < ids.length; i += 100) {
        await db.from('video_snapshots').delete().in('id', ids.slice(i, i + 100));
      }

      aggregated += weeklyMap.size;
      deleted += ids.length;
      if (snaps.length < 500) break;
    }

    console.log(`  Weekly rows: ${aggregated}, Snapshots deleted: ${deleted}`);
    return { quota: 0, items: aggregated };
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
