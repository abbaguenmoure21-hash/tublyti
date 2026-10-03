/**
 * Promote proposed topics with >= N attached videos to active.
 *
 * Usage:
 *   npx tsx scripts/promote-topics.ts --dry-run    # show what would be promoted (default)
 *   npx tsx scripts/promote-topics.ts --apply       # promote them
 *   npx tsx scripts/promote-topics.ts --apply --min=5  # min 5 videos
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
const minArg = process.argv.find(a => a.startsWith('--min='));
const MIN_VIDEOS = minArg ? parseInt(minArg.split('=')[1], 10) : 2;

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log(`\n=== Promotion sujets (min ${MIN_VIDEOS} vidéos) ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===\n`);

  const { data: niches } = await db.from('niches').select('id, name');
  const nicheNames = new Map((niches ?? []).map(n => [n.id, n.name]));

  const { data: proposedTopics } = await db
    .from('topics')
    .select('id, label, niche_id')
    .eq('status', 'proposed');

  const toPromote: { id: string; label: string; niche: string; videoCount: number }[] = [];

  for (const topic of proposedTopics ?? []) {
    const { count } = await db
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topic.id);

    if ((count ?? 0) >= MIN_VIDEOS) {
      toPromote.push({
        id: topic.id,
        label: topic.label,
        niche: nicheNames.get(topic.niche_id) ?? 'Unknown',
        videoCount: count ?? 0,
      });
    }
  }

  // Group by niche
  const byNiche = new Map<string, typeof toPromote>();
  for (const t of toPromote) {
    if (!byNiche.has(t.niche)) byNiche.set(t.niche, []);
    byNiche.get(t.niche)!.push(t);
  }

  for (const [niche, topics] of byNiche) {
    console.log(`--- ${niche} (${topics.length}) ---`);
    for (const t of topics) {
      console.log(`  ${t.label} (${t.videoCount} vidéos)`);
    }
  }

  console.log(`\nTotal: ${toPromote.length} sujets à promouvoir`);

  if (!DRY_RUN && toPromote.length > 0) {
    const ids = toPromote.map(t => t.id);
    const { error } = await db.from('topics').update({ status: 'active' }).in('id', ids);
    if (error) {
      console.error(`Erreur: ${error.message}`);
    } else {
      console.log(`${ids.length} sujets passés en active.`);
    }
  } else if (DRY_RUN) {
    console.log('\n(DRY RUN — relancer avec --apply pour promouvoir)');
  }
}

main().catch(console.error);
