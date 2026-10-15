/**
 * Import des impressions et du CTR des miniatures (YouTube Reporting API), seul.
 * Même étape que « reach » de la tâche de nuit, pour tester sans relancer tout le pipeline.
 *
 *   npx tsx scripts/reach-sync.ts            (en local, lit .env.local)
 *   GitHub → Actions → « Reach sync » → Run workflow
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

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

import { syncReachReports } from '../lib/youtube/reporting';
import { SupabaseJobRunner } from '../lib/jobs/supabase-runner';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes');
  const db = createClient(url, key);
  const runner = new SupabaseJobRunner(db);
  const job = await runner.start('reach');
  try {
    const r = await syncReachReports(db, Date.now() + 5 * 60_000);
    console.log(`Chaînes : ${r.channels} · nouvelles tâches : ${r.jobsCreated} · fichiers : ${r.files} · lignes : ${r.rows}`);
    if (r.errors.length) console.log(`Erreurs : ${r.errors.join(' | ')}`);
    const failed = r.errors.length > 0 && r.rows === 0 && r.errors.length === r.channels && r.channels > 0;
    await runner.finish(job.id, { quotaUsed: 0, itemsProcessed: r.rows, ...(failed ? { error: r.errors[0] } : {}) });
    if (failed) process.exit(1);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    await runner.finish(job.id, { quotaUsed: 0, itemsProcessed: 0, error: msg });
    process.exit(1);
  }
}

main();
