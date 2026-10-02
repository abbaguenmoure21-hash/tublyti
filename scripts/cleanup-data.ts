/**
 * Cleanup script — identifies low-quality data for removal.
 *
 * Usage:
 *   pnpm cleanup --dry-run     # show what would change (default)
 *   pnpm cleanup --apply       # actually apply changes
 *
 * Actions:
 *   1. Channels: followed channels with <3k subs AND <1k median views → status='inactive'
 *   2. Candidates: discovered via 'trending' or 'comment_author' → status='ignored'
 *   3. Topics: 'proposed' without qualified video → status='rejected'
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

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey);

  console.log(`\n=== Cleanup ${DRY_RUN ? '(DRY RUN — nothing will change)' : '(APPLYING CHANGES)'} ===\n`);

  // ── 1. Low-quality followed channels → inactive ──────────────────
  console.log('1. Channels with <3k subs AND <1k median views:');

  const { data: lowChannels } = await db
    .from('channels')
    .select('id, title, subscriber_count, status')
    .lt('subscriber_count', 3000)
    .neq('status', 'inactive');

  // For median views, we need to compute from snapshots
  const channelsToDeactivate: { id: string; title: string; subs: number; medianViews: number }[] = [];

  for (const ch of lowChannels ?? []) {
    const { data: snaps } = await db
      .from('video_snapshots')
      .select('views, videos!inner(channel_id)')
      .eq('videos.channel_id', ch.id)
      .order('captured_at', { ascending: false })
      .limit(50);

    const views = (snaps ?? []).map((s) => s.views ?? 0).sort((a, b) => a - b);
    const medianViews = views.length > 0 ? views[Math.floor(views.length / 2)] : 0;

    if (medianViews < 1000) {
      channelsToDeactivate.push({
        id: ch.id,
        title: ch.title ?? ch.id,
        subs: ch.subscriber_count ?? 0,
        medianViews,
      });
    }
  }

  if (channelsToDeactivate.length === 0) {
    console.log('   None found.\n');
  } else {
    for (const ch of channelsToDeactivate) {
      console.log(`   - ${ch.title} (${ch.subs} subs, ${ch.medianViews} median views)`);
    }
    console.log(`   Total: ${channelsToDeactivate.length} channels\n`);

    if (!DRY_RUN) {
      const ids = channelsToDeactivate.map((c) => c.id);
      const { error } = await db.from('channels').update({ status: 'inactive' }).in('id', ids);
      if (error) console.error(`   ERROR: ${error.message}`);
      else console.log(`   ✓ ${ids.length} channels set to inactive.\n`);
    }
  }

  // ── 2. Candidates from trending/comment_author → ignored ─────────
  console.log('2. Candidate channels from trending/comment_author:');

  const { data: badCandidates } = await db
    .from('candidate_channels')
    .select('id, title, discovered_via, status')
    .in('discovered_via', ['trending', 'comment_author'])
    .neq('status', 'ignored');

  if (!badCandidates?.length) {
    console.log('   None found.\n');
  } else {
    for (const c of badCandidates.slice(0, 20)) {
      console.log(`   - ${c.title ?? c.id} (via ${c.discovered_via}, status: ${c.status})`);
    }
    if (badCandidates.length > 20) {
      console.log(`   ... and ${badCandidates.length - 20} more`);
    }
    console.log(`   Total: ${badCandidates.length} candidates\n`);

    if (!DRY_RUN) {
      const ids = badCandidates.map((c) => c.id);
      const { error } = await db.from('candidate_channels').update({ status: 'ignored' }).in('id', ids);
      if (error) console.error(`   ERROR: ${error.message}`);
      else console.log(`   ✓ ${ids.length} candidates set to ignored.\n`);
    }
  }

  // ── 3. Proposed topics without qualified video → rejected ────────
  console.log('3. Proposed topics without qualified video:');

  const { data: proposedTopics } = await db
    .from('topics')
    .select('id, label, niche_id')
    .eq('status', 'proposed');

  const topicsToReject: { id: string; label: string }[] = [];

  for (const topic of proposedTopics ?? []) {
    const { count } = await db
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topic.id)
      .eq('is_qualified', true);

    if (!count || count === 0) {
      topicsToReject.push({ id: topic.id, label: topic.label });
    }
  }

  if (topicsToReject.length === 0) {
    console.log('   None found.\n');
  } else {
    for (const t of topicsToReject.slice(0, 20)) {
      console.log(`   - ${t.label}`);
    }
    if (topicsToReject.length > 20) {
      console.log(`   ... and ${topicsToReject.length - 20} more`);
    }
    console.log(`   Total: ${topicsToReject.length} topics\n`);

    if (!DRY_RUN) {
      const ids = topicsToReject.map((t) => t.id);
      const { error } = await db.from('topics').update({ status: 'rejected' }).in('id', ids);
      if (error) console.error(`   ERROR: ${error.message}`);
      else console.log(`   ✓ ${ids.length} topics set to rejected.\n`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('=== Summary ===');
  console.log(`  Channels → inactive: ${channelsToDeactivate.length}`);
  console.log(`  Candidates → ignored: ${badCandidates?.length ?? 0}`);
  console.log(`  Topics → rejected: ${topicsToReject.length}`);

  if (DRY_RUN) {
    console.log('\n  (DRY RUN — run with --apply to execute changes)');
  } else {
    console.log('\n  Changes applied.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
