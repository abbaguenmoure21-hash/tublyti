/**
 * Apply pending migrations via Supabase REST API.
 * Since we can't run raw SQL, we use the REST API to add columns
 * by attempting operations and checking errors.
 *
 * For operations that require ALTER TABLE, outputs the SQL
 * to paste in Supabase SQL Editor.
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
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const missing: string[] = [];

  async function checkColumn(table: string, column: string): Promise<boolean> {
    const { error } = await db.from(table).select(column).limit(1);
    if (error && error.message.includes(column)) return false;
    return true;
  }

  async function checkTable(table: string): Promise<boolean> {
    const { error } = await db.from(table).select('*').limit(1);
    if (error && (error.message.includes('does not exist') || error.message.includes('relation'))) return false;
    return true;
  }

  console.log('Checking migration 00014...');

  // Settings (can do via REST)
  const { error: qpErr } = await db.from('settings').upsert(
    { key: 'quota_plan', value: { tracking: 3500, discovery: 3000, comments: 2000, reserve: 1500 } },
    { onConflict: 'key' },
  );
  console.log('  quota_plan setting:', qpErr ? 'ERROR ' + qpErr.message : 'OK');

  // candidate_channels columns
  const ccCols = ['embedding_similarity', 'auto_decision', 'auto_reason', 'long_video_count', 'niche_id'];
  for (const col of ccCols) {
    const exists = await checkColumn('candidate_channels', col);
    if (exists) {
      console.log(`  candidate_channels.${col}: OK`);
    } else {
      console.log(`  candidate_channels.${col}: MISSING`);
      missing.push(`candidate_channels.${col}`);
    }
  }

  // niches columns
  for (const col of ['target_channels', 'coverage_sufficient']) {
    const exists = await checkColumn('niches', col);
    if (exists) {
      console.log(`  niches.${col}: OK`);
    } else {
      console.log(`  niches.${col}: MISSING`);
      missing.push(`niches.${col}`);
    }
  }

  console.log('\nChecking migration 00015...');
  const srExists = await checkTable('search_results');
  if (srExists) {
    console.log('  search_results: OK');
  } else {
    console.log('  search_results: MISSING');
    missing.push('search_results (table)');
  }

  if (missing.length === 0) {
    console.log('\nAll migrations applied!');
    return;
  }

  console.log(`\n=== ${missing.length} items need SQL Editor ===`);
  console.log('Copy and paste the following SQL into Supabase SQL Editor:');
  console.log('https://supabase.com/dashboard/project/olmqymvpeglqnjuphtif/sql\n');
  console.log('--- START SQL ---\n');

  if (missing.some((m) => m.startsWith('candidate_channels'))) {
    console.log(`-- Migration 00014: candidate_channels columns
DO $$
BEGIN
  ALTER TABLE candidate_channels
    ADD COLUMN IF NOT EXISTS embedding_similarity numeric,
    ADD COLUMN IF NOT EXISTS auto_decision text,
    ADD COLUMN IF NOT EXISTS auto_reason text,
    ADD COLUMN IF NOT EXISTS long_video_count integer,
    ADD COLUMN IF NOT EXISTS niche_id uuid REFERENCES niches(id);
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'candidate_channels not yet created';
END;
$$;
`);
  }

  if (missing.some((m) => m.startsWith('niches'))) {
    console.log(`-- Migration 00014: niches columns
ALTER TABLE niches
  ADD COLUMN IF NOT EXISTS target_channels integer DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS coverage_sufficient boolean DEFAULT false;
`);
  }

  if (missing.some((m) => m.includes('search_results'))) {
    console.log(readFileSync(resolve(process.cwd(), 'supabase/migrations/00015_search_results.sql'), 'utf-8'));
  }

  console.log('\n--- END SQL ---');
}

main().catch(console.error);
