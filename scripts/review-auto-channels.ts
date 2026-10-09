/**
 * Reclasse les chaînes ajoutées automatiquement au catalogue avec la méthode actuelle
 * (profil complet : description, mots-clés, catégories YouTube, tags, descriptions de vidéos ; IA si activée).
 *
 *   pnpm review-auto-channels            # simulation : combien de chaînes seraient reclassées
 *   pnpm review-auto-channels --apply    # les remet « à classer » ; le classement se fait ensuite avec
 *                                        # pnpm auto-validate --chaines --apply (ou la nuit suivante)
 *
 * Rien n'est supprimé : une chaîne reste dans sa niche actuelle jusqu'à ce que la nouvelle soit décidée,
 * puis elle change de niche (ou rejoint une niche créée pour elle).
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

const APPLY = process.argv.includes('--apply');

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await db
    .from('candidate_channels')
    .select('id, title, niche_id, niche_source, niches(name)')
    .eq('status', 'followed')
    .not('decided_at', 'is', null)
    .neq('niche_source', 'manual');
  if (error) throw new Error(`${error.message} (migrations 00024 à 00026 lancées ?)`);
  const rows = (data ?? []) as unknown as { id: string; title: string | null; niches: { name: string } | null }[];
  console.log(`\n=== ${rows.length} chaînes ajoutées automatiquement ${APPLY ? '(APPLIQUÉ)' : '(SIMULATION)'} ===`);
  for (const r of rows.slice(0, 40)) console.log(`  ${r.title ?? r.id} — niche actuelle : ${r.niches?.name ?? '—'}`);
  if (rows.length > 40) console.log(`  … et ${rows.length - 40} autres`);
  if (APPLY && rows.length) {
    await db
      .from('candidate_channels')
      .update({ status: 'pending', profile_text: null, decided_at: null, auto_reason: 'À reclasser avec le profil complet.' })
      .in('id', rows.map((r) => r.id));
    console.log(`\n${rows.length} chaînes remises « à classer ». Lance maintenant : pnpm auto-validate --chaines --apply`);
  } else {
    console.log(`\nRelance avec --apply pour les reclasser.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
