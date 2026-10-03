/**
 * List Business & Case Studies channels without videos in last 90 days.
 * Proposes to set them inactive.
 *
 * Usage:
 *   npx tsx scripts/check-business-channels.ts --dry-run   # list only (default)
 *   npx tsx scripts/check-business-channels.ts --apply      # set inactive
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

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Find Business & Case Studies niche
  const { data: niches } = await db
    .from('niches')
    .select('id, name')
    .ilike('name', '%business%');

  if (!niches?.length) {
    console.log('Niche "Business & Case Studies" not found');
    return;
  }

  const niche = niches[0];
  console.log(`\n=== ${niche.name} — Chaînes sans vidéo récente ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===\n`);

  const { data: channels } = await db
    .from('channels')
    .select('id, title, subscriber_count, status')
    .eq('niche_id', niche.id)
    .eq('status', 'active');

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const toDeactivate: { id: string; title: string; subs: number; videoCount: number }[] = [];
  const active: { id: string; title: string; subs: number; videoCount: number }[] = [];

  for (const ch of channels ?? []) {
    const { count } = await db
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('channel_id', ch.id)
      .gte('published_at', cutoff);

    const videoCount = count ?? 0;
    const entry = {
      id: ch.id,
      title: ch.title ?? ch.id,
      subs: ch.subscriber_count ?? 0,
      videoCount,
    };

    if (videoCount === 0) {
      toDeactivate.push(entry);
    } else {
      active.push(entry);
    }
  }

  console.log(`Chaînes actives avec vidéos récentes: ${active.length}`);
  for (const ch of active) {
    console.log(`  ✓ ${ch.title} (${ch.subs.toLocaleString()} subs, ${ch.videoCount} vidéos)`);
  }

  console.log(`\nChaînes sans vidéo < 90 j: ${toDeactivate.length}`);
  for (const ch of toDeactivate) {
    console.log(`  ✗ ${ch.title} (${ch.subs.toLocaleString()} subs)`);
  }

  if (!DRY_RUN && toDeactivate.length > 0) {
    const ids = toDeactivate.map((c) => c.id);
    const { error } = await db.from('channels').update({ status: 'inactive' }).in('id', ids);
    if (error) {
      console.error(`Erreur: ${error.message}`);
    } else {
      console.log(`\n${ids.length} chaînes passées en inactive.`);
    }
  } else if (DRY_RUN) {
    console.log('\n(DRY RUN — relancer avec --apply pour désactiver)');
  }
}

main().catch(console.error);
