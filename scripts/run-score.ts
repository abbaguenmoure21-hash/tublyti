/**
 * Score all active/in_production topics (MGI 0-100 + phase).
 *
 * Usage:
 *   npx tsx scripts/run-score.ts
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

import { runScore } from '../lib/scoring/score-service';
import { computeAllOutliers } from '../lib/scoring/outlier-service';
import { ConsoleAlertSender } from '../lib/email/resend-alerts';

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const alertSender = new ConsoleAlertSender();

  console.log('\n=== Scoring MGI ===\n');

  const result = await runScore(db, alertSender);
  console.log(`Topics scored: ${result.topicsScored}`);
  console.log(`Topics skipped (< 5 videos): ${result.topicsSkipped}`);
  console.log(`Burn-down alerts: ${result.burnDownAlerts}`);
  console.log(`Alert events: ${result.alertEventsCreated}`);
  if (result.silentCollectionAlert) console.log('Silent collection alert triggered');

  console.log('\n=== Outliers ===\n');
  try {
    const outliers = await computeAllOutliers(db);
    console.log(`Outliers computed: ${outliers.computed}, skipped: ${outliers.skipped}`);
  } catch (err) {
    console.error(`Outliers failed: ${(err as Error).message}`);
  }
}

main().catch(console.error);
