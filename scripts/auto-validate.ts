/**
 * Validation automatique : sujets proposés + chaînes candidates (niche détectée).
 *
 *   pnpm auto-validate               # simulation : affiche les décisions, n'écrit rien
 *   pnpm auto-validate --apply       # applique
 *   pnpm auto-validate --sujets      # seulement les sujets
 *   pnpm auto-validate --chaines     # seulement les chaînes candidates
 *
 * Coût : sujets = rien. Chaînes = 2 à 3 unités de quota YouTube par chaîne lue et quelques centimes
 * d'embeddings Voyage (15 titres par chaîne), y compris en simulation. Nouvelles niches (--apply seulement) :
 * ~0,002 $ de Claude Haiku par niche nommée, 2 niches au plus par passage, dans la limite d'AI_BUDGET_USD.
 * Ne pas lancer pendant un run de nuit.
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

import { autoValidateTopics } from '../lib/topics/auto-validate';
import { classifyCandidates } from '../lib/youtube/candidate-niche';
import { VoyageEmbeddingProvider } from '../lib/providers/voyage-embeddings';

const APPLY = process.argv.includes('--apply');
const ONLY_TOPICS = process.argv.includes('--sujets');
const ONLY_CHANNELS = process.argv.includes('--chaines');

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`\n=== Validation automatique ${APPLY ? '(APPLIQUÉE)' : '(SIMULATION — rien n’est écrit)'} ===`);

  if (!ONLY_CHANNELS) {
    const t = await autoValidateTopics(db, { dryRun: !APPLY });
    console.log(`\n— Sujets proposés : ${t.checked}`);
    console.log(`  publiés ${t.published} · fusionnés ${t.merged} · en attente ${t.waiting} · sensibles (manuel) ${t.sensitive}`);
    for (const d of t.decisions.filter((x) => x.decision !== 'waiting').slice(0, 40)) {
      console.log(`  [${d.decision}] ${d.label} — ${d.reason}`);
    }
    const waiting = t.decisions.filter((x) => x.decision === 'waiting');
    if (waiting.length) console.log(`  … ${waiting.length} en attente, ex. : ${waiting.slice(0, 5).map((w) => `${w.label} (${w.reason})`).join(' | ')}`);
  }

  if (!ONLY_TOPICS) {
    if (!process.env.VOYAGE_API_KEY) {
      console.log('\nVOYAGE_API_KEY absente : chaînes candidates ignorées.');
    } else {
      const c = await classifyCandidates(db, new VoyageEmbeddingProvider(), { limit: 200, dryRun: !APPLY, deadline: Date.now() + 20 * 60_000 });
      const cal = c.calibration;
      console.log(`\n— Chaînes candidates`);
      console.log(`  Seuils calibrés sur ${cal.sample} chaînes du catalogue : accepter ≥ ${Math.round(cal.acceptSim * 100)} %, refuser < ${Math.round(cal.rejectSim * 100)} %`);
      console.log(`  lues ${c.read} · niche détectée ${c.detected} · acceptées ${c.accepted} · refusées ${c.rejected} · hors niche ${c.unmatched} · ajoutées au catalogue ${c.promoted} · quota ${c.quotaUsed}`);
      for (const d of c.decisions.slice(0, 60)) console.log(`  [${d.decision === 'accepted' ? 'OK ' : d.decision === 'unmatched' ? 'HORS' : 'NON'}] ${d.title ?? d.id} — ${d.reason}`);
      const n = c.niches;
      if (n) {
        console.log(`\n— Nouvelles niches${APPLY ? '' : ' (simulation : nom tiré des titres, l’IA nommera la vraie niche)'}`);
        for (const x of n.created) console.log(`  + ${x.name} [${x.category}] RPM ${x.rpm} — ${x.channels.join(', ')}`);
        for (const x of n.joined) console.log(`  → rattachées à ${x.niche} : ${x.channels.join(', ')}`);
        console.log(`  hors niche en attente de voisines : ${n.waiting} · expirées : ${n.expired} · coût IA : ${n.aiCostUSD.toFixed(4)} $`);
      }
    }
  }
  console.log(APPLY ? '\nTerminé.' : '\nSimulation terminée. Relance avec --apply pour appliquer.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
