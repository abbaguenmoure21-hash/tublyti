/**
 * Reject stale topics: active/proposed topics with < 5 videos AND > 21 days old.
 * Never closes topics that have a user-claimed angle (angles.user_id IS NOT NULL).
 *
 * Usage:
 *   npx tsx scripts/reject-empty-topics.ts --dry-run   # list topics (default)
 *   npx tsx scripts/reject-empty-topics.ts --apply      # reject them
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

import { rejectStaleTopics } from '../lib/topics/reject-stale';

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(`\n=== Sujets insuffisants > 21 jours ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===\n`);

  const result = await rejectStaleTopics(db, DRY_RUN);

  for (const detail of result.details) {
    console.log(`  ${detail}`);
  }

  console.log(`\nTotal: ${result.rejected} ${DRY_RUN ? 'seraient rejetés' : 'rejetés'}, ${result.protected} protégés`);

  if (DRY_RUN) {
    console.log('\n(DRY RUN — relancer avec --apply pour rejeter)');
  }
}

main().catch(console.error);
