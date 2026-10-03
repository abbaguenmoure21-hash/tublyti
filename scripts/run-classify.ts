/**
 * Classify all unlabeled comments via Anthropic Batch API.
 * Submits ALL batches in one go (results are async, retrieved on next run).
 *
 * Usage:
 *   npx tsx scripts/run-classify.ts               # submit all unlabeled
 *   npx tsx scripts/run-classify.ts --retrieve     # retrieve pending results only
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

import { runClassify } from '../lib/nlp/classify-service';

const RETRIEVE_ONLY = process.argv.includes('--retrieve');

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const deadline = Date.now() + 10 * 60 * 1000;

  console.log('\n=== Classification des commentaires ===\n');

  if (RETRIEVE_ONLY) {
    const result = await runClassify(db, deadline);
    console.log(`  Batches retrieved: ${result.batchesRetrieved}`);
    console.log(`  Labels stored: ${result.labelsStored}`);
    return;
  }

  // Submit all unlabeled in batches of 500
  let totalSubmitted = 0;
  let totalLabeled = 0;
  let round = 0;

  while (true) {
    round++;
    const result = await runClassify(db, deadline);
    totalSubmitted += result.commentsSubmitted;
    totalLabeled += result.labelsStored;

    console.log(`Round ${round}: submitted=${result.commentsSubmitted}, retrieved=${result.batchesRetrieved}, labeled=${result.labelsStored}, cost=$${result.estimatedCostUSD.toFixed(4)}`);

    if (result.skippedBudget) {
      console.log('Budget limit reached — stopping.');
      break;
    }
    if (!result.batchSubmitted && result.labelsStored === 0 && result.batchesRetrieved === 0) {
      console.log('Nothing more to do.');
      break;
    }
    if (!result.batchSubmitted) break;
  }

  console.log(`\nTotal: ${totalSubmitted} comments submitted in ${round} batches, ${totalLabeled} labels retrieved`);
}

main().catch(console.error);
