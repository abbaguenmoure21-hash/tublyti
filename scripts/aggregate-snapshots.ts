/**
 * Aggregate old video_snapshots into video_stats_weekly rows.
 * Keeps daily snapshots for the last 30 days, compresses older ones.
 *
 * Usage: npx tsx scripts/aggregate-snapshots.ts
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

import { aggregateOldSnapshots } from '../lib/youtube/aggregate-snapshots';

const RETENTION_DAYS = 30;

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey);
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  console.log(`Aggregating snapshots older than ${cutoff.toISOString().slice(0, 10)}...`);

  // Same code path as the nightly step (video_snapshots has no id column: key = video_id + captured_at).
  const r = await aggregateOldSnapshots(db, cutoff, Date.now() + 30 * 60_000);
  console.log(`\nDone (${r.mode}). Weekly rows: ${r.weeklyRows}, Deleted: ${r.deleted} snapshots${r.stoppedByTimeout ? ' — stopped by timeout' : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
