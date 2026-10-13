/**
 * Local nightly pipeline.
 * Order: user-channels → collect → embed → attach → enrich-insufficient
 *        → discover-topics → quality-gates → search-emerging → search
 *        → discover-sources/channels → auto-triage → embed+attach (pass 2)
 *        → classify → score → reject-stale → aggregate.
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
import { runCollect, runCommentIngestion } from '../lib/youtube/collect';
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
import { runAttachInsufficient, searchForEmergingTopics, type EmergingSearchResult } from '../lib/topics/enrich-insufficient';
import { rejectStaleTopics } from '../lib/topics/reject-stale';
import { updateUserChannelSubs } from '../lib/youtube/update-user-channels';
import { syncReachReports } from '../lib/youtube/reporting';
import { ResendAlertSender, ConsoleAlertSender } from '../lib/email/resend-alerts';
import { SupabaseJobRunner } from '../lib/jobs/supabase-runner';

const DEADLINE_MS = parseInt(process.env.NIGHTLY_DEADLINE_MIN ?? '15', 10) * 60 * 1000;
const EMBED_MAX_PER_NIGHT = parseInt(process.env.EMBED_MAX_PER_NIGHT ?? '3000', 10);
// Minimum time (ms) guaranteed for attach and enrich-insufficient.
const MIN_STEP_MS = 10 * 60 * 1000; // 10 minutes

const skippedSteps: string[] = [];

async function runStep(
  runner: SupabaseJobRunner,
  deadline: number,
  kind: string,
  fn: () => Promise<{ quota: number; items: number }>,
): Promise<void> {
  if (Date.now() >= deadline) {
    console.log(`  [${kind}] SKIPPED — deadline reached`);
    skippedSteps.push(kind);
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
  // collect 30% (down from 40%), embed 15%, discover+triage 20%, classify 15%, score+agg rest
  // attach & enrich-insufficient get their own MIN_STEP_MS from when they start.
  const collectEnd     = start + DEADLINE_MS * 0.30;
  const embedEnd       = start + DEADLINE_MS * 0.45;
  const discoverEnd    = start + DEADLINE_MS * 0.65;
  const classifyEnd    = start + DEADLINE_MS * 0.80;
  // Découverte de chaînes et 2e passe : tout le temps restant, en gardant 15 % pour le classement et le calcul du potentiel.
  const lateEnd        = start + DEADLINE_MS * 0.85;

  console.log(`  Time budgets: collect ${Math.round(DEADLINE_MS * 0.30 / 60000)}min, embed ${Math.round(DEADLINE_MS * 0.15 / 60000)}min, discover ${Math.round(DEADLINE_MS * 0.20 / 60000)}min, classify ${Math.round(DEADLINE_MS * 0.15 / 60000)}min, score+agg rest`);
  console.log(`  Embed cap: ${EMBED_MAX_PER_NIGHT} videos/night, attach/enrich min: ${MIN_STEP_MS / 60000}min each`);

  // ── Step 1: USER-CHANNELS (fast — ~1 API call per 50 channels) ──
  console.log('\n========== USER-CHANNELS ==========');

  await runStep(runner, deadline, 'user-channels', async () => {
    const uc = await updateUserChannelSubs(db);
    console.log(`  Updated: ${uc.updated}, Handles resolved: ${uc.resolved}, Quota: ${uc.quotaUsed}`);
    return { quota: uc.quotaUsed, items: uc.updated };
  });

  // ── Step 2: COLLECT (signals + videos + snapshots + comments) ────
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

  // ── Step 3: EMBED (capped to EMBED_MAX_PER_NIGHT, most recent first) ──
  console.log('\n========== EMBED ==========');

  await runStep(runner, embedEnd, 'embed', async () => {
    const { embedded } = await runEmbedAll(db, embedder, embedEnd, EMBED_MAX_PER_NIGHT);
    console.log(`  Embedded: ${embedded} videos (cap: ${EMBED_MAX_PER_NIGHT})`);
    return { quota: 0, items: embedded };
  });

  // ── Step 4: ATTACH (own deadline: at least MIN_STEP_MS from now) ──
  console.log('\n========== ATTACH ==========');

  await runStep(runner, deadline, 'attach', async () => {
    const attachDeadline = Math.min(Date.now() + MIN_STEP_MS, deadline);
    const { attached, orphans } = await runAttachAll(db, attachDeadline);
    console.log(`  Attached: ${attached}, Orphans: ${orphans}`);
    return { quota: 0, items: attached };
  });

  // ── Step 5: ENRICH-INSUFFICIENT (own deadline: at least MIN_STEP_MS) ──
  console.log('\n========== ENRICH-INSUFFICIENT ==========');

  let enrichInsuffResult: { topicsProcessed: number; videosAttached: number; details: Record<string, number> } = { topicsProcessed: 0, videosAttached: 0, details: {} };
  await runStep(runner, deadline, 'enrich-insufficient', async () => {
    const enrichDeadline = Math.min(Date.now() + MIN_STEP_MS, deadline);
    enrichInsuffResult = await runAttachInsufficient(db, enrichDeadline);
    console.log(`  Topics enriched: ${enrichInsuffResult.topicsProcessed}, Videos attached: ${enrichInsuffResult.videosAttached}`);
    if (enrichInsuffResult.topicsProcessed > 0) {
      for (const [label, count] of Object.entries(enrichInsuffResult.details)) {
        console.log(`    ${label}: +${count}`);
      }
    }
    return { quota: 0, items: enrichInsuffResult.videosAttached };
  });

  // ── Step 5a: REACH (impressions et CTR des miniatures, YouTube Reporting API — sans quota Data API) ──
  console.log('\n========== REACH ==========');

  await runStep(runner, deadline, 'reach', async () => {
    const r = await syncReachReports(db, Math.min(Date.now() + 5 * 60_000, deadline));
    console.log(`  Channels: ${r.channels}, New jobs: ${r.jobsCreated}, Files: ${r.files}, Rows: ${r.rows}${r.errors.length ? `, Errors: ${r.errors.join(' | ')}` : ''}`);
    if (r.errors.length && r.rows === 0 && r.channels > 0 && r.errors.length === r.channels) throw new Error(r.errors[0]);
    return { quota: 0, items: r.rows };
  });

  // ── Step 5b: COMMENTS (own window: up to COMMENTS_MIN minutes, quota budget « comments ») ──
  // Séparée de la collecte : avant, elle arrivait en fin de collecte et sautait faute de temps.
  console.log('\n========== COMMENTS ==========');

  await runStep(runner, deadline, 'comments', async () => {
    const commentsDeadline = Math.min(Date.now() + parseInt(process.env.COMMENTS_MIN ?? '8', 10) * 60_000, deadline);
    const c = await runCommentIngestion(db, yt, commentsDeadline);
    console.log(`  Videos: ${c.videosChecked}, Comments: ${c.commentsImported}, Purged: ${c.commentsPurged}, Quota: ${c.quotaUsed}${c.stoppedByQuota ? ' (budget atteint)' : ''}${c.stoppedByTimeout ? ' (temps atteint)' : ''}`);
    return { quota: c.quotaUsed, items: c.commentsImported };
  });

  // ── Step 6: DISCOVER-TOPICS (cluster orphans into new topics) ──
  console.log('\n========== DISCOVER-TOPICS ==========');

  await runStep(runner, discoverEnd, 'discover-topics', async () => {
    const clustering = await runClustering(db, embedder, discoverEnd);
    console.log(`  Proposed: ${clustering.topicsProposed}`);
    return { quota: 0, items: clustering.topicsProposed };
  });

  // ── Step 7: QUALITY-GATES (reject single-channel-dominated topics) ──
  console.log('\n========== QUALITY-GATES ==========');

  await runStep(runner, deadline, 'quality-gates', async () => {
    const gates = await runQualityGates(db);
    console.log(`  Rejected (mono-channel): ${gates.rejectedMonoChannel}`);
    console.log(`  Rejected (channel-name): ${gates.rejectedChannelName}`);
    console.log(`  Sensitive flagged: ${gates.sensitiveFlagged}`);
    return { quota: 0, items: gates.rejectedMonoChannel + gates.rejectedChannelName + (gates.autoPublished ?? 0) + (gates.autoMerged ?? 0) };
  });

  // ── Step 8: SEARCH-EMERGING (capped at 15 searches — runs before main search) ──
  console.log('\n========== SEARCH-EMERGING ==========');

  let emergingResult: EmergingSearchResult = { searchesPerformed: 0, videosFound: 0, videosAttached: 0, quotaUsed: 0 };
  await runStep(runner, discoverEnd, 'search-emerging', async () => {
    emergingResult = await searchForEmergingTopics(db, embedder, discoverEnd, yt.getQuotaUsed());
    console.log(`  Searches: ${emergingResult.searchesPerformed}, Found: ${emergingResult.videosFound}, Attached: ${emergingResult.videosAttached}, Candidate channels: ${emergingResult.channelsProposed ?? 0}`);
    console.log(`  Quota: ${emergingResult.quotaUsed}`);
    return { quota: emergingResult.quotaUsed, items: emergingResult.videosAttached + (emergingResult.channelsProposed ?? 0) };
  });

  // ── Step 9: SEARCH ──────────────────────────────────────────────
  console.log('\n========== SEARCH ==========');

  await runStep(runner, discoverEnd, 'search', async () => {
    const search = await runYouTubeSearch(db, discoverEnd, yt.getQuotaUsed());
    console.log(`  Searches: ${search.searchesPerformed}, Discovered: ${search.videosDiscovered}`);
    return { quota: 0, items: search.videosDiscovered };
  });

  // ── Step 10: DISCOVER-SOURCES (channelSections + search results) ─
  console.log('\n========== DISCOVER-SOURCES ==========');

  await runStep(runner, lateEnd, 'discover-sources', async () => {
    const sources = await runDiscoverySources(db, lateEnd, 500);
    console.log(`  channelSections: ${sources.channelSections.channelsDiscovered} channels (${sources.channelSections.quotaUsed} quota)`);
    console.log(`  searchResults: ${sources.searchResults.channelsDiscovered} channels`);
    const totalQuota = sources.channelSections.quotaUsed;
    const totalChannels = sources.channelSections.channelsDiscovered + sources.searchResults.channelsDiscovered;
    return { quota: totalQuota, items: totalChannels };
  });

  // ── Step 11: DISCOVER-CHANNELS (search for new channels in phase 1/2 topics) ─
  console.log('\n========== DISCOVER-CHANNELS ==========');

  await runStep(runner, lateEnd, 'discover-channels', async () => {
    const disc = await discoverChannels(db, lateEnd, yt.getQuotaUsed());
    console.log(`  Searches: ${disc.searchesPerformed}, Channels: ${disc.channelsDiscovered}`);
    console.log(`  Faceless estimated: ${disc.facelessEstimated} ($${disc.estimatedCostUSD.toFixed(3)})`);
    if (disc.stoppedByQuota) console.log('  Stopped by quota');
    if (disc.stoppedByTimeout) console.log('  Stopped by timeout');

    // Retrieve any pending faceless batch results
    const batchUpdated = await retrieveDiscoveryBatches(db);
    if (batchUpdated > 0) console.log(`  Faceless batches updated: ${batchUpdated}`);

    return { quota: 0, items: disc.channelsDiscovered };
  });

  // ── Step 12: AUTO-TRIAGE (enrich + classify pending candidates) ─
  console.log('\n========== AUTO-TRIAGE ==========');

  await runStep(runner, deadline, 'auto-triage', async () => {
    const triage = await autoTriageCandidates(db, embedder);
    console.log(`  Processed: ${triage.processed}, Accepted: ${triage.accepted}, Rejected: ${triage.rejected}, Manual: ${triage.manual}`);
    console.log(`  Enriched: ${triage.enriched}, Promoted: ${triage.promoted}`);
    return { quota: triage.quotaUsed, items: triage.processed };
  });

  // ── Step 13: EMBED-2 + ATTACH-2 (new videos from search) ──────
  console.log('\n========== EMBED+ATTACH (pass 2) ==========');

  await runStep(runner, lateEnd, 'embed-pass2', async () => {
    const { embedded } = await runEmbedAll(db, embedder, lateEnd);
    const { attached, orphans } = await runAttachAll(db, lateEnd);
    console.log(`  Embedded: ${embedded}, Attached: ${attached}, Orphans: ${orphans}`);
    return { quota: 0, items: embedded + attached };
  });

  // ── Step 14: CLASSIFY (retrieve pending batches + submit new) ───
  console.log('\n========== CLASSIFY ==========');

  if (process.env.ANTHROPIC_API_KEY) {
    await runStep(runner, deadline, 'classify', async () => {
      const classify = await runClassify(db, Math.min(deadline, Math.max(classifyEnd, Date.now() + 3 * 60_000)));
      console.log(`  Submitted: ${classify.commentsSubmitted}, Labels: ${classify.labelsStored}`);
      console.log(`  Batches: submitted=${classify.batchSubmitted}, retrieved=${classify.batchesRetrieved}`);
      return { quota: 0, items: classify.labelsStored };
    });
  } else {
    console.log('  ANTHROPIC_API_KEY not set — skipped');
  }

  // ── Step 15: SCORE (MGI + phase + outliers) ────────────────────
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

  // ── Step 16: REJECT-STALE (close topics < 5 videos after 21 days) ──
  console.log('\n========== REJECT-STALE ==========');

  let rejectResult = { rejected: 0, protected: 0 };
  await runStep(runner, deadline, 'reject-stale', async () => {
    const r = await rejectStaleTopics(db);
    rejectResult = r;
    console.log(`  Rejected: ${r.rejected}, Protected: ${r.protected}`);
    for (const detail of r.details) {
      console.log(`    ${detail}`);
    }
    return { quota: 0, items: r.rejected };
  });

  // ── Step 17: AGGREGATE (compress old snapshots into weekly) ────
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
  console.log(`  Enrichment: topics enriched ${enrichInsuffResult.topicsProcessed}, videos attached ${enrichInsuffResult.videosAttached}`);
  console.log(`  Emerging: searches ${emergingResult.searchesPerformed} (quota ${emergingResult.quotaUsed}), attached ${emergingResult.videosAttached}`);
  console.log(`  Stale: rejected ${rejectResult.rejected}, protected ${rejectResult.protected}`);
  if (skippedSteps.length > 0) {
    console.log(`  Skipped steps: ${skippedSteps.join(', ')}`);
  } else {
    console.log('  Skipped steps: none');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
