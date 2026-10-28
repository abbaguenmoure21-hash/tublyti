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
import type { EmbeddingProvider } from '../lib/providers/embeddings';
import { runQualityGates } from '../lib/topics/quality-gates';
import { discoverChannels, retrieveDiscoveryBatches } from '../lib/youtube/discover-channels';
import { runDiscoverySources } from '../lib/youtube/discover-sources';
import { autoTriageCandidates } from '../lib/youtube/auto-triage';
import { runAttachInsufficient, searchForEmergingTopics, type EmergingSearchResult } from '../lib/topics/enrich-insufficient';
import { rejectStaleTopics } from '../lib/topics/reject-stale';
import { updateUserChannelSubs } from '../lib/youtube/update-user-channels';
import { syncReachReports } from '../lib/youtube/reporting';
import { runThumbWatch } from '../lib/youtube/thumb-watch';
import { ResendAlertSender, ConsoleAlertSender } from '../lib/email/resend-alerts';
import { SupabaseJobRunner } from '../lib/jobs/supabase-runner';
import { DEFAULT_TARGET_MIN, MIN_USEFUL_MS, NIGHTLY_SHARES, planWindow, stepBudgetMs, stepMaxMs, tailReserveMs } from '../lib/jobs/nightly-plan';
import {
  QuotaLedger,
  QuotaSoftLimitReached,
  flushQuotaLedger,
  installQuotaMeter,
  loadQuotaSpentToday,
  pacificDay,
} from '../lib/youtube/quota';
import { aggregateOldSnapshots } from '../lib/youtube/aggregate-snapshots';
import type { SupabaseClient } from '@supabase/supabase-js';

const DEADLINE_MS = parseInt(process.env.NIGHTLY_DEADLINE_MIN ?? '15', 10) * 60 * 1000;
const EMBED_MAX_PER_NIGHT = parseInt(process.env.EMBED_MAX_PER_NIGHT ?? '3000', 10);
// Maximum time (ms) for attach and enrich-insufficient.
// Planned steps end by NIGHTLY_TARGET_MIN (default 65 min); classify + score use the tail before the deadline.
const TARGET_MS = parseInt(process.env.NIGHTLY_TARGET_MIN ?? String(DEFAULT_TARGET_MIN), 10) * 60_000;
// Explicit per-step overrides (minutes), otherwise the step's share of the budget (lib/jobs/nightly-plan.ts).
const envMin = (name: string) => (process.env[name] ? parseInt(process.env[name]!, 10) * 60_000 : null);
const STEP_OVERRIDES: Record<string, number | null> = {
  'thumb-watch': envMin('THUMB_WATCH_MIN'),
  comments: envMin('COMMENTS_MIN'),
  'auto-triage': envMin('TRIAGE_MIN'),
};
// Fast closing steps (reject-stale, aggregate) and score always run, within this grace after the deadline.
const GRACE_MS = 5 * 60_000;
// Steps whose failure makes the GitHub run fail (red) — the workflow alert then fires too.
const CRITICAL_STEPS = new Set(['collect', 'comments', 'score']);

type StepStatus = 'ok' | 'error' | 'skipped';
interface StepOutcome {
  kind: string;
  status: StepStatus;
  reason?: string;
  plannedMs: number;
  actualMs: number;
  quota: number;
  items: number;
}

const outcomes: StepOutcome[] = [];
const skippedSteps: string[] = [];
let ledger: QuotaLedger;
let nightDb: SupabaseClient;

/**
 * Run one step inside its window (`deadline` = absolute end, computed just before the step).
 * - not enough time / missing key → job closed as « skipped: … », never alerted;
 * - YouTube soft limit reached → « skipped: quota … (partial) »;
 * - any other error → job error, no per-step e-mail (one summary at the end).
 * The job's quota is this step's real share of the process-wide ledger.
 */
async function runStep(
  runner: SupabaseJobRunner,
  deadline: number,
  kind: string,
  fn: (end: number) => Promise<{ quota?: number; items: number }>,
  opts: { skipReason?: string | null } = {},
): Promise<void> {
  const t0 = Date.now();
  const plannedMs = Math.max(0, deadline - t0);
  const skip = async (reason: string) => {
    console.log(`  [${kind}] SKIPPED — ${reason}`);
    skippedSteps.push(kind);
    outcomes.push({ kind, status: 'skipped', reason, plannedMs, actualMs: 0, quota: 0, items: 0 });
    const job = await runner.start(kind);
    await runner.finish(job.id, { quotaUsed: 0, itemsProcessed: 0, error: `skipped: ${reason}` }, { alert: false });
  };
  if (opts.skipReason) return skip(opts.skipReason);
  if (plannedMs < MIN_USEFUL_MS) return skip('deadline reached');

  ledger.setTask(kind);
  const quotaBefore = ledger.runUsed();
  const job = await runner.start(kind);
  console.log(`  [${kind}] planned ${(plannedMs / 60_000).toFixed(1)} min`);
  let status: StepStatus = 'ok';
  let reason: string | undefined;
  let items = 0;
  try {
    const result = await fn(deadline);
    items = result.items;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof QuotaSoftLimitReached && !ledger.exhausted) {
      status = 'skipped';
      reason = `quota soft limit reached (partial): ${msg}`;
      console.log(`  [${kind}] stopped — ${msg}`);
    } else {
      status = 'error';
      reason = msg;
      console.error(`  [${kind}] ERROR: ${msg}`);
    }
  }
  const quota = ledger.runUsed() - quotaBefore;
  const actualMs = Date.now() - t0;
  outcomes.push({ kind, status, reason, plannedMs, actualMs, quota, items });
  ledger.setTask('other');
  try {
    await runner.finish(
      job.id,
      { quotaUsed: quota, itemsProcessed: items, ...(reason ? { error: status === 'skipped' ? `skipped: ${reason}` : reason } : {}) },
      { alert: false },
    );
  } catch (err) {
    console.error(`  [${kind}] could not close job: ${err instanceof Error ? err.message : err}`);
  }
  await flushQuotaLedger(nightDb, ledger).catch(() => {});
  console.log(`  [${kind}] ${status} in ${(actualMs / 60_000).toFixed(1)} min (planned ${(plannedMs / 60_000).toFixed(1)}), quota ${quota}`);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey);
  nightDb = db;
  const start = Date.now();
  const nightStartIso = new Date(start).toISOString();
  const deadline = start + DEADLINE_MS;
  const reserve = tailReserveMs(DEADLINE_MS);
  const budget = stepBudgetMs(DEADLINE_MS, TARGET_MS);
  const planEnd = start + budget;
  // Window for a step: its own maximum, minus the time kept for classify + score.
  // Window of a step: its share of the budget (or override), never past the planned end.
  const stepMax = (kind: string) => STEP_OVERRIDES[kind] ?? stepMaxMs(kind, budget);
  const win = (kind: string) => planWindow(Date.now(), planEnd, stepMax(kind), 0).end;

  // One quota counter for the whole process, starting from what was already spent this Pacific day.
  const day = pacificDay();
  ledger = new QuotaLedger();
  ledger.setBase(await loadQuotaSpentToday(db, day));
  installQuotaMeter(ledger);
  const yt = new RealYouTubeClient(undefined, ledger.softLimit);
  console.log(`  YouTube quota: ${ledger.total()} already spent on ${day} (Pacific), soft limit ${ledger.softLimit}`);

  const alertSender = process.env.RESEND_API_KEY && process.env.ALERT_EMAIL
    ? new ResendAlertSender()
    : new ConsoleAlertSender();
  const runner = new SupabaseJobRunner(db);
  runner.setAlertSender(alertSender);
  // Jobs left open by a killed / cancelled run.
  const abandoned = await runner.cleanAbandoned().catch(() => 0);
  if (abandoned > 0) console.log(`  Closed ${abandoned} abandoned job(s) from a previous run`);

  // No random data in production: without a Voyage key, steps that write embeddings are skipped.
  const embedder: EmbeddingProvider | null = process.env.VOYAGE_API_KEY ? new VoyageEmbeddingProvider() : null;
  const noEmbedder = embedder ? null : 'VOYAGE_API_KEY missing';

  const sumMax = NIGHTLY_SHARES.reduce((sum, [k]) => sum + stepMax(k), 0);
  console.log(`  Deadline ${DEADLINE_MS / 60000} min, steps budget ${(budget / 60000).toFixed(0)} min (sum of step maxima ${(sumMax / 60000).toFixed(0)} min), tail reserve (classify + score) ${Math.round(reserve / 60000)} min`);
  console.log(`  Embed cap: ${EMBED_MAX_PER_NIGHT} videos/night`);

  // ── Step 1: USER-CHANNELS (fast — ~1 API call per 50 channels) ──
  console.log('\n========== USER-CHANNELS ==========');

  await runStep(runner, win('user-channels'), 'user-channels', async () => {
    const uc = await updateUserChannelSubs(db);
    console.log(`  Updated: ${uc.updated}, Handles resolved: ${uc.resolved}, Quota: ${uc.quotaUsed}`);
    return { items: uc.updated };
  });

  // ── Step 2: COLLECT (signals + videos + snapshots) ────
  console.log('\n========== COLLECT ==========');

  await runStep(runner, win('collect'), 'collect', async (end) => {
    console.log('  Videos & snapshots...');
    const collect = await runCollect(db, yt, end);
    console.log(`    Channels: ${collect.channelsUpdated}, Videos: ${collect.videosDiscovered} (RSS: ${collect.videosFromRSS}, API: ${collect.videosFromAPI})`);
    console.log(`    Snapshots: ${collect.snapshotsTaken}`);
    if (collect.stoppedByQuota) console.log('    Stopped by quota budget');
    if (collect.stoppedByTimeout) console.log('    Stopped by timeout');

    return { items: collect.videosDiscovered + collect.snapshotsTaken + collect.commentsImported };
  });

  // ── Step 2b: SIGNALS (Trends, HN, average views per topic) — own step, after the snapshots ──
  // Before, it ran first inside « collect »: one read error there skipped the whole view collection.
  console.log('\n========== SIGNALS ==========');

  await runStep(runner, win('signals'), 'signals', async (end) => {
    const signals = await collectSignals(db, end);
    console.log(`  Trend: ${signals.trendPointsCollected}, Social: ${signals.socialPointsCollected}, YT: ${signals.ytViewPointsCollected}`);
    return { items: signals.trendPointsCollected + signals.socialPointsCollected + signals.ytViewPointsCollected };
  });

  // ── Step 3: EMBED (capped to EMBED_MAX_PER_NIGHT, most recent first) ──
  console.log('\n========== EMBED ==========');

  await runStep(runner, win('embed'), 'embed', async (end) => {
    const { embedded } = await runEmbedAll(db, embedder!, end, EMBED_MAX_PER_NIGHT);
    console.log(`  Embedded: ${embedded} videos (cap: ${EMBED_MAX_PER_NIGHT})`);
    return { items: embedded };
  }, { skipReason: noEmbedder });

  // ── Step 4: ATTACH ──
  console.log('\n========== ATTACH ==========');

  await runStep(runner, win('attach'), 'attach', async (end) => {
    const { attached, orphans } = await runAttachAll(db, end, { incremental: true });
    console.log(`  Attached: ${attached}, Orphans: ${orphans}`);
    return { items: attached };
  });

  // ── Step 5: ENRICH-INSUFFICIENT ──
  console.log('\n========== ENRICH-INSUFFICIENT ==========');

  let enrichInsuffResult: { topicsProcessed: number; videosAttached: number; details: Record<string, number> } = { topicsProcessed: 0, videosAttached: 0, details: {} };
  await runStep(runner, win('enrich-insufficient'), 'enrich-insufficient', async (end) => {
    enrichInsuffResult = await runAttachInsufficient(db, end, { checkedSince: nightStartIso });
    console.log(`  Topics enriched: ${enrichInsuffResult.topicsProcessed}, Videos attached: ${enrichInsuffResult.videosAttached}`);
    if (enrichInsuffResult.topicsProcessed > 0) {
      for (const [label, count] of Object.entries(enrichInsuffResult.details)) {
        console.log(`    ${label}: +${count}`);
      }
    }
    return { items: enrichInsuffResult.videosAttached };
  });

  // ── Step 5a: REACH (impressions et CTR des miniatures, YouTube Reporting API — sans quota Data API) ──
  console.log('\n========== REACH ==========');

  await runStep(runner, win('reach'), 'reach', async (end) => {
    const r = await syncReachReports(db, end);
    console.log(`  Channels: ${r.channels}, New jobs: ${r.jobsCreated}, Files: ${r.files}, Rows: ${r.rows}${r.errors.length ? `, Errors: ${r.errors.join(' | ')}` : ''}`);
    if (r.errors.length && r.rows === 0 && r.channels > 0 && r.errors.length === r.channels) throw new Error(r.errors[0]);
    return { items: r.rows };
  });

  // ── Step 5a-bis: THUMB-WATCH (miniatures changées, empreinte d'image, 4 min max) ──
  console.log('\n========== THUMB-WATCH ==========');

  await runStep(runner, win('thumb-watch'), 'thumb-watch', async (end) => {
    const r = await runThumbWatch(db, end);
    console.log(`  Checked: ${r.checked}, Changed: ${r.changed}, Archived: ${r.archived}, Errors: ${r.errors}`);
    return { items: r.changed };
  });

  // ── Step 5b: COMMENTS (own window: up to COMMENTS_MIN minutes, quota budget « comments ») ──
  console.log('\n========== COMMENTS ==========');

  await runStep(runner, win('comments'), 'comments', async (end) => {
    const c = await runCommentIngestion(db, yt, end);
    console.log(`  Videos: ${c.videosChecked}, Comments: ${c.commentsImported}, Purged: ${c.commentsPurged}, Quota: ${c.quotaUsed}${c.stoppedByQuota ? ' (budget atteint)' : ''}${c.stoppedByTimeout ? ' (temps atteint)' : ''}`);
    return { items: c.commentsImported };
  });

  // ── Step 6: DISCOVER-TOPICS (cluster orphans into new topics) ──
  console.log('\n========== DISCOVER-TOPICS ==========');

  await runStep(runner, win('discover-topics'), 'discover-topics', async (end) => {
    // runClustering only reads stored embeddings (its embedder argument is unused).
    const clustering = await runClustering(db, embedder as EmbeddingProvider, end);
    console.log(`  Proposed: ${clustering.topicsProposed}`);
    return { items: clustering.topicsProposed };
  });

  // ── Step 7: QUALITY-GATES (reject single-channel-dominated topics) ──
  console.log('\n========== QUALITY-GATES ==========');

  await runStep(runner, win('quality-gates'), 'quality-gates', async () => {
    const gates = await runQualityGates(db);
    console.log(`  Rejected (mono-channel): ${gates.rejectedMonoChannel}`);
    console.log(`  Rejected (channel-name): ${gates.rejectedChannelName}`);
    console.log(`  Sensitive flagged: ${gates.sensitiveFlagged}`);
    return { items: gates.rejectedMonoChannel + gates.rejectedChannelName + (gates.autoPublished ?? 0) + (gates.autoMerged ?? 0) };
  });

  // ── Step 8: SEARCH-EMERGING (capped at 15 searches — runs before main search) ──
  console.log('\n========== SEARCH-EMERGING ==========');

  let emergingResult: EmergingSearchResult = { searchesPerformed: 0, videosFound: 0, videosAttached: 0, quotaUsed: 0 };
  await runStep(runner, win('search-emerging'), 'search-emerging', async (end) => {
    // yt.getQuotaUsed() = today's process-wide total (every step included).
    emergingResult = await searchForEmergingTopics(db, embedder!, end, yt.getQuotaUsed());
    console.log(`  Searches: ${emergingResult.searchesPerformed}, Found: ${emergingResult.videosFound}, Attached: ${emergingResult.videosAttached}, Candidate channels: ${emergingResult.channelsProposed ?? 0}`);
    return { items: emergingResult.videosAttached + (emergingResult.channelsProposed ?? 0) };
  }, { skipReason: noEmbedder });

  // ── Step 9: SEARCH ──────────────────────────────────────────────
  console.log('\n========== SEARCH ==========');

  await runStep(runner, win('search'), 'search', async (end) => {
    const search = await runYouTubeSearch(db, end, yt.getQuotaUsed());
    console.log(`  Searches: ${search.searchesPerformed}, Discovered: ${search.videosDiscovered}`);
    return { items: search.videosDiscovered };
  });

  // ── Step 10: DISCOVER-SOURCES (channelSections + search results) ─
  console.log('\n========== DISCOVER-SOURCES ==========');

  await runStep(runner, win('discover-sources'), 'discover-sources', async (end) => {
    const sources = await runDiscoverySources(db, end, 500);
    console.log(`  channelSections: ${sources.channelSections.channelsDiscovered} channels (${sources.channelSections.quotaUsed} quota)`);
    console.log(`  searchResults: ${sources.searchResults.channelsDiscovered} channels`);
    return { items: sources.channelSections.channelsDiscovered + sources.searchResults.channelsDiscovered };
  });

  // ── Step 11: DISCOVER-CHANNELS (search for new channels in phase 1/2 topics) ─
  console.log('\n========== DISCOVER-CHANNELS ==========');

  await runStep(runner, win('discover-channels'), 'discover-channels', async (end) => {
    const disc = await discoverChannels(db, end, yt.getQuotaUsed());
    console.log(`  Searches: ${disc.searchesPerformed}, Channels: ${disc.channelsDiscovered}`);
    console.log(`  Faceless estimated: ${disc.facelessEstimated} ($${disc.estimatedCostUSD.toFixed(3)})`);
    if (disc.stoppedByQuota) console.log('  Stopped by quota');
    if (disc.stoppedByTimeout) console.log('  Stopped by timeout');

    // Retrieve any pending faceless batch results
    const batchUpdated = await retrieveDiscoveryBatches(db);
    if (batchUpdated > 0) console.log(`  Faceless batches updated: ${batchUpdated}`);

    return { items: disc.channelsDiscovered };
  });

  // ── Step 12: AUTO-TRIAGE (enrich + classify pending candidates) ─
  console.log('\n========== AUTO-TRIAGE ==========');

  await runStep(runner, win('auto-triage'), 'auto-triage', async (end) => {
    const triage = await autoTriageCandidates(db, embedder, 100, end);
    console.log(`  Processed: ${triage.processed}, Accepted: ${triage.accepted}, Rejected: ${triage.rejected}, Manual: ${triage.manual}`);
    console.log(`  Enriched: ${triage.enriched}, Promoted: ${triage.promoted}`);
    return { items: triage.processed };
  });

  // ── Step 13: EMBED-2 + ATTACH-2 (new videos from search) ──────
  console.log('\n========== EMBED+ATTACH (pass 2) ==========');

  await runStep(runner, win('embed-pass2'), 'embed-pass2', async (end) => {
    const embedded = embedder ? (await runEmbedAll(db, embedder, end)).embedded : 0;
    const { attached, orphans } = await runAttachAll(db, end, { incremental: true });
    console.log(`  Embedded: ${embedded}, Attached: ${attached}, Orphans: ${orphans}`);
    return { items: embedded + attached };
  });

  // ── Step 14: CLASSIFY (retrieve pending batches + submit new) ───
  console.log('\n========== CLASSIFY ==========');

  // Keeps its own minimum of 3 min, but never eats the time kept for score.
  const scoreReserve = Math.min(5 * 60_000, reserve);
  const classifyEnd = Math.max(Math.min(Date.now() + 5 * 60_000, deadline - scoreReserve), Math.min(Date.now() + 3 * 60_000, deadline));
  await runStep(runner, classifyEnd, 'classify', async (end) => {
    const classify = await runClassify(db, end);
    console.log(`  Submitted: ${classify.commentsSubmitted}, Labels: ${classify.labelsStored}`);
    console.log(`  Batches: submitted=${classify.batchSubmitted}, retrieved=${classify.batchesRetrieved}`);
    return { items: classify.labelsStored };
  }, { skipReason: process.env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY missing' });

  // ── Step 15: SCORE (MGI + phase + outliers) — critical, always runs (grace after the deadline) ──
  console.log('\n========== SCORE ==========');

  const scoreEnd = Math.max(deadline, Date.now()) + GRACE_MS;
  await runStep(runner, scoreEnd, 'score', async () => {
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

    return { items: score.topicsScored + outlierCount };
  });

  // ── Step 16: REJECT-STALE (close topics < 5 videos after 21 days) ──
  console.log('\n========== REJECT-STALE ==========');

  let rejectResult = { rejected: 0, protected: 0 };
  // Étape rapide (moins d'une seconde) : toujours exécutée, même si le temps est écoulé.
  const rejectEnd = Math.max(deadline, Date.now()) + GRACE_MS;
  await runStep(runner, rejectEnd, 'reject-stale', async () => {
    const r = await rejectStaleTopics(db);
    rejectResult = r;
    console.log(`  Rejected: ${r.rejected}, Protected: ${r.protected}`);
    for (const detail of r.details) {
      console.log(`    ${detail}`);
    }
    return { items: r.rejected };
  });

  // ── Step 17: AGGREGATE (compress snapshots older than 30 days into weekly rows) ────
  console.log('\n========== AGGREGATE ==========');

  // Toujours exécutée, avec son propre délai (même les nuits en retard).
  const aggregateEnd = Math.max(deadline, Date.now()) + GRACE_MS;
  await runStep(runner, aggregateEnd, 'aggregate', async (end) => {
    const r = await aggregateOldSnapshots(db, new Date(Date.now() - 30 * 86_400_000), Math.min(end, Date.now() + 4 * 60_000));
    console.log(`  Weekly rows: ${r.weeklyRows}, Snapshots deleted: ${r.deleted} (${r.mode})${r.stoppedByTimeout ? ' — stopped by timeout' : ''}`);
    return { items: r.deleted };
  });

  // ── Summary ────────────────────────────────────────────────────
  await flushQuotaLedger(db, ledger).catch(() => {});
  const elapsedMs = Date.now() - start;
  const errors = outcomes.filter((o) => o.status === 'error');
  const criticalErrors = errors.filter((o) => CRITICAL_STEPS.has(o.kind));
  const fmtMin = (ms: number) => (ms / 60_000).toFixed(1);

  console.log(`\n========== DONE in ${(elapsedMs / 1000).toFixed(0)}s ==========`);
  console.log(`  YouTube quota: ${ledger.runUsed()} this run, ${ledger.total()}/${ledger.softLimit} today (${day} Pacific)${ledger.exhausted ? ' — DAILY QUOTA EXHAUSTED' : ''}`);
  console.log(`  Quota by step: ${Object.entries(ledger.taskUsage()).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  console.log(`  Enrichment: topics enriched ${enrichInsuffResult.topicsProcessed}, videos attached ${enrichInsuffResult.videosAttached}`);
  console.log(`  Emerging: searches ${emergingResult.searchesPerformed} (quota ${emergingResult.quotaUsed}), attached ${emergingResult.videosAttached}`);
  console.log(`  Stale: rejected ${rejectResult.rejected}, protected ${rejectResult.protected}`);
  console.log('  Steps (planned / actual min, quota):');
  for (const o of outcomes) {
    console.log(`    ${o.kind.padEnd(20)} ${o.status.padEnd(7)} ${fmtMin(o.plannedMs).padStart(5)} / ${fmtMin(o.actualMs).padStart(5)}  q=${o.quota}${o.reason ? `  — ${o.reason.slice(0, 120)}` : ''}`);
  }
  console.log(`  Skipped steps: ${skippedSteps.length ? skippedSteps.join(', ') : 'none'}`);
  console.log(`  GitHub Actions estimate: ~${Math.round((elapsedMs / 60_000 + 3) * 30)} min/month at this duration (+3 min setup per run)`);

  // One summary e-mail per night, only when something really failed (skipped steps never alert).
  if (errors.length > 0 || ledger.exhausted) {
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://tublyti.vercel.app').replace(/\/+$/, '');
    const lines = [
      ...errors.map((o) => `• ${o.kind}${CRITICAL_STEPS.has(o.kind) ? ' (essentielle)' : ''} : ${o.reason}`),
      skippedSteps.length ? `\nÉtapes sautées : ${skippedSteps.join(', ')}` : '',
      `\nQuota YouTube : ${ledger.total()}/${ledger.softLimit} aujourd'hui${ledger.exhausted ? ' — quota du jour épuisé' : ''}`,
    ];
    try {
      await alertSender.send({
        kind: 'cron_failed',
        subject: `Nuit du ${new Date().toISOString().slice(0, 10)} : ${errors.length} étape(s) en échec`,
        body: lines.join('\n'),
        actionUrl: `${baseUrl}/admin/jobs`,
        actionLabel: 'Voir les jobs',
      });
    } catch (err) {
      console.error(`  Summary alert failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // A failed critical step (or an exhausted quota) turns the GitHub run red: the workflow alert fires too.
  if (criticalErrors.length > 0 || ledger.exhausted) {
    console.error(`  FAILED: ${criticalErrors.map((o) => o.kind).join(', ') || 'YouTube daily quota exhausted'}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
