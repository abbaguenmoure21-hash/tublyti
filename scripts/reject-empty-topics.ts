/**
 * Reject proposed topics with 0 attached videos.
 * Keeps their topic_queries as search seeds.
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

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(`\n=== Sujets sans vidéo ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===\n`);

  const { data: niches } = await db.from('niches').select('id, name');
  const nicheNames = new Map((niches ?? []).map((n) => [n.id, n.name]));

  const { data: proposedTopics } = await db
    .from('topics')
    .select('id, label, niche_id')
    .eq('status', 'proposed');

  const toReject: { id: string; label: string; niche: string }[] = [];

  for (const topic of proposedTopics ?? []) {
    const { count } = await db
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topic.id);

    if (!count || count === 0) {
      toReject.push({
        id: topic.id,
        label: topic.label,
        niche: nicheNames.get(topic.niche_id) ?? 'Unknown',
      });
    }
  }

  // Group by niche
  const byNiche = new Map<string, typeof toReject>();
  for (const t of toReject) {
    if (!byNiche.has(t.niche)) byNiche.set(t.niche, []);
    byNiche.get(t.niche)!.push(t);
  }

  for (const [niche, topics] of byNiche) {
    console.log(`--- ${niche} (${topics.length}) ---`);
    for (const t of topics) {
      console.log(`  - ${t.label}`);
    }
  }

  console.log(`\nTotal: ${toReject.length} sujets proposed sans vidéo`);

  // Count queries that will be preserved
  const topicIds = toReject.map((t) => t.id);
  if (topicIds.length > 0) {
    const { count: queryCount } = await db
      .from('topic_queries')
      .select('id', { count: 'exact', head: true })
      .in('topic_id', topicIds);
    console.log(`Requêtes de recherche préservées: ${queryCount ?? 0}`);
  }

  if (!DRY_RUN && toReject.length > 0) {
    const { error } = await db
      .from('topics')
      .update({ status: 'rejected' })
      .in('id', topicIds);

    if (error) {
      console.error(`Erreur: ${error.message}`);
    } else {
      console.log(`\n${toReject.length} sujets passés en rejected.`);
      console.log('Les topic_queries restent intactes comme graines de recherche.');
    }
  } else if (DRY_RUN) {
    console.log('\n(DRY RUN — relancer avec --apply pour rejeter)');
  }
}

main().catch(console.error);
