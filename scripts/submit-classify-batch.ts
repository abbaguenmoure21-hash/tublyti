/**
 * Submit ALL unlabeled comments as a single Anthropic Batch API request.
 * Then exit. Use retrieve-batches.ts to get results.
 *
 * Usage:
 *   npx tsx scripts/submit-classify-batch.ts
 */
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

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

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_BATCH_SIZE = 10000; // Anthropic batch limit
const PAGE_SIZE = 1000; // Supabase default max per query

async function fetchAll(db: ReturnType<typeof createClient>, table: string, columns: string) {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const { data } = await db.from(table).select(columns).range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const anthropic = new Anthropic();

  const systemPrompt = readFileSync(join(process.cwd(), 'lib/nlp/prompts/classify_v1.md'), 'utf-8');

  // Get ALL labeled comment IDs (paginated)
  const labeledRows = await fetchAll(db, 'comment_labels', 'comment_id');
  const labeledSet = new Set(labeledRows.map(r => r.comment_id as string));
  console.log(`Already labeled: ${labeledSet.size}`);

  // Get ALL comments (paginated)
  const allComments: { id: string; text: string }[] = [];
  let offset = 0;
  while (true) {
    const { data } = await db
      .from('comments')
      .select('id, text')
      .order('like_count', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    allComments.push(...(data as { id: string; text: string }[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  console.log(`Total comments fetched: ${allComments.length}`);

  // Deduplicate by comment ID (some comments appear multiple times)
  const seen = new Set<string>();
  const unlabeled: typeof allComments = [];
  for (const c of allComments) {
    if (!labeledSet.has(c.id) && !seen.has(c.id)) {
      seen.add(c.id);
      unlabeled.push(c);
    }
  }
  console.log(`Unlabeled (unique): ${unlabeled.length}`);

  if (unlabeled.length === 0) {
    console.log('Nothing to classify.');
    return;
  }

  // Build batch requests
  const toSubmit = unlabeled.slice(0, MAX_BATCH_SIZE);
  const requests = toSubmit.map(c => ({
    custom_id: c.id,
    params: {
      model: MODEL,
      max_tokens: 256 as const,
      system: systemPrompt,
      messages: [{ role: 'user' as const, content: c.text }],
    },
  }));

  console.log(`Submitting batch of ${requests.length} comments...`);

  const batch = await anthropic.messages.batches.create({ requests });
  console.log(`Batch created: ${batch.id}`);
  console.log(`Status: ${batch.processing_status}`);

  // Store batch ID for retrieval
  const { data: pendingSetting } = await db.from('settings').select('value').eq('key', 'pending_batches').single();
  const pendingBatches: string[] = (pendingSetting?.value as string[]) ?? [];
  pendingBatches.push(batch.id);
  await db.from('settings').upsert({ key: 'pending_batches', value: pendingBatches });

  // Estimate cost (Batch API = 50% off)
  const inputCost = (requests.length * 300 * 0.40) / 1_000_000;
  const outputCost = (requests.length * 60 * 2.0) / 1_000_000;
  console.log(`Estimated cost: $${(inputCost + outputCost).toFixed(4)}`);
  console.log(`\nRun 'pnpm exec tsx scripts/retrieve-batches.ts' to get results (typically ready in 5-30 min).`);
}

main().catch(console.error);
