/**
 * Retrieve pending Anthropic Batch API results (no new submissions).
 *
 * Usage:
 *   npx tsx scripts/retrieve-batches.ts
 */
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
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

type FrustrationLabel = 'no_one_explains' | 'wish_video_on' | 'stopped_too_early' | 'searched_long' | 'none';
const VALID_LABELS: FrustrationLabel[] = ['no_one_explains', 'wish_video_on', 'stopped_too_early', 'searched_long', 'none'];
const MODEL_TAG = 'haiku-4.5-classify_v1';

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const anthropic = new Anthropic();

  const { data: pendingSetting } = await db.from('settings').select('value').eq('key', 'pending_batches').single();
  const pendingBatches: string[] = (pendingSetting?.value as string[]) ?? [];

  console.log(`\n=== Retrieval de ${pendingBatches.length} batches ===\n`);

  const stillPending: string[] = [];
  let totalLabeled = 0;

  for (const batchId of pendingBatches) {
    try {
      const batch = await anthropic.messages.batches.retrieve(batchId);
      console.log(`  ${batchId}: ${batch.processing_status}`);

      if (batch.processing_status === 'ended') {
        let batchLabeled = 0;
        const resultsStream = await anthropic.messages.batches.results(batchId);
        for await (const item of resultsStream) {
          if (item.result.type === 'succeeded') {
            const content = item.result.message.content[0];
            if (content.type === 'text') {
              try {
                let jsonText = content.text.trim();
                const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (fenceMatch) jsonText = fenceMatch[1].trim();

                const parsed = JSON.parse(jsonText);
                const label = VALID_LABELS.includes(parsed.label) ? parsed.label : null;
                if (!label) continue;

                await db.from('comment_labels').upsert({
                  comment_id: item.custom_id,
                  label,
                  requested_angle: parsed.requested_angle || null,
                  confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
                  model: MODEL_TAG,
                });
                batchLabeled++;
              } catch {
                // skip malformed
              }
            }
          }
        }
        totalLabeled += batchLabeled;
        console.log(`    → ${batchLabeled} labels stored`);
      } else {
        stillPending.push(batchId);
      }
    } catch (err) {
      console.error(`  ${batchId}: error — ${(err as Error).message}`);
      stillPending.push(batchId);
    }
  }

  await db.from('settings').upsert({ key: 'pending_batches', value: stillPending });

  console.log(`\n=== Résumé ===`);
  console.log(`  Labels stored: ${totalLabeled}`);
  console.log(`  Still pending: ${stillPending.length}`);

  // Final stats
  const { count: labeledCount } = await db.from('comment_labels').select('comment_id', { count: 'exact', head: true });
  const { count: totalComments } = await db.from('comments').select('id', { count: 'exact', head: true });
  console.log(`  Total labeled: ${labeledCount}/${totalComments}`);
}

main().catch(console.error);
