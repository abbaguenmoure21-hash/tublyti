import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FrustrationLabel } from './classifier';

// ── Constants ────────────────────────────────────────────────────────
const PROMPT_VERSION = 'classify_v1';
const MODEL = 'claude-3-5-haiku-latest';
const MODEL_TAG = `haiku-4.5-${PROMPT_VERSION}`;
const BATCH_SIZE = 500;

// Batch API pricing (50% off standard Haiku 4.5)
const INPUT_COST_PER_MTOK = 0.40;
const OUTPUT_COST_PER_MTOK = 2.0;
const EST_INPUT_TOKENS = 300; // system prompt + comment
const EST_OUTPUT_TOKENS = 60; // JSON response

const VALID_LABELS: FrustrationLabel[] = [
  'no_one_explains',
  'wish_video_on',
  'stopped_too_early',
  'searched_long',
  'none',
];

// ── Types ────────────────────────────────────────────────────────────
export interface ClassifyResult {
  batchesRetrieved: number;
  labelsStored: number;
  batchSubmitted: boolean;
  commentsSubmitted: number;
  estimatedCostUSD: number;
  budgetRemainingUSD: number;
  skippedBudget: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────
function loadSystemPrompt(): string {
  return readFileSync(
    join(process.cwd(), 'lib/nlp/prompts/classify_v1.md'),
    'utf-8',
  );
}

function estimateCostUSD(commentCount: number): number {
  const inputCost = (commentCount * EST_INPUT_TOKENS * INPUT_COST_PER_MTOK) / 1_000_000;
  const outputCost = (commentCount * EST_OUTPUT_TOKENS * OUTPUT_COST_PER_MTOK) / 1_000_000;
  return inputCost + outputCost;
}

function monthKey(): string {
  const d = new Date();
  return `ai_spend_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parseLabel(raw: string): FrustrationLabel | null {
  if (VALID_LABELS.includes(raw as FrustrationLabel)) return raw as FrustrationLabel;
  return null;
}

// ── Main service ─────────────────────────────────────────────────────
export async function runClassify(
  db: SupabaseClient,
  deadline: number,
): Promise<ClassifyResult> {
  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const isTimedOut = () => Date.now() >= deadline;

  const result: ClassifyResult = {
    batchesRetrieved: 0,
    labelsStored: 0,
    batchSubmitted: false,
    commentsSubmitted: 0,
    estimatedCostUSD: 0,
    budgetRemainingUSD: 0,
    skippedBudget: false,
  };

  // ── Step 1: Retrieve pending batch results ──────────────────────
  const { data: pendingSetting } = await db
    .from('settings')
    .select('value')
    .eq('key', 'pending_batches')
    .single();

  const pendingBatches: string[] = (pendingSetting?.value as string[]) ?? [];
  const stillPending: string[] = [];

  for (const batchId of pendingBatches) {
    if (isTimedOut()) {
      stillPending.push(batchId);
      continue;
    }

    try {
      const batch = await anthropic.messages.batches.retrieve(batchId);

      if (batch.processing_status === 'ended') {
        // Retrieve and store results
        const resultsStream = await anthropic.messages.batches.results(batchId);
        for await (const item of resultsStream) {
          if (item.result.type === 'succeeded') {
            const content = item.result.message.content[0];
            if (content.type === 'text') {
              try {
                // Strip markdown code fences if present
                let jsonText = content.text.trim();
                const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (fenceMatch) jsonText = fenceMatch[1].trim();

                const parsed = JSON.parse(jsonText);
                const label = parseLabel(parsed.label);
                if (!label) continue;

                await db.from('comment_labels').upsert({
                  comment_id: item.custom_id,
                  label,
                  requested_angle: parsed.requested_angle || null,
                  confidence:
                    typeof parsed.confidence === 'number'
                      ? Math.min(1, Math.max(0, parsed.confidence))
                      : 0.5,
                  model: MODEL_TAG,
                });
                result.labelsStored++;
              } catch {
                // Malformed JSON — skip
              }
            }
          }
        }
        result.batchesRetrieved++;
      } else {
        stillPending.push(batchId);
      }
    } catch {
      // API error retrieving batch — keep it pending for next run
      stillPending.push(batchId);
    }
  }

  // Update pending batches list
  await db.from('settings').upsert({ key: 'pending_batches', value: stillPending });

  if (isTimedOut()) return result;

  // ── Step 2: Find unlabeled comments ─────────────────────────────
  const { data: labeledRows } = await db
    .from('comment_labels')
    .select('comment_id');
  const labeledSet = new Set((labeledRows ?? []).map((r) => r.comment_id));

  const { data: candidateComments } = await db
    .from('comments')
    .select('id, text')
    .order('like_count', { ascending: false })
    .limit(BATCH_SIZE + labeledSet.size);

  const unlabeled = (candidateComments ?? [])
    .filter((c) => !labeledSet.has(c.id))
    .slice(0, BATCH_SIZE);

  if (unlabeled.length === 0) return result;

  // ── Step 3: Budget check ────────────────────────────────────────
  const cost = estimateCostUSD(unlabeled.length);
  const mk = monthKey();
  const { data: spendRow } = await db
    .from('settings')
    .select('value')
    .eq('key', mk)
    .single();
  const currentSpend = typeof spendRow?.value === 'number' ? spendRow.value : 0;
  const budgetLimit = parseFloat(process.env.AI_BUDGET_USD ?? '30');

  result.budgetRemainingUSD = budgetLimit - currentSpend;

  if (currentSpend + cost > budgetLimit) {
    result.skippedBudget = true;
    result.estimatedCostUSD = cost;
    return result;
  }

  if (isTimedOut()) return result;

  // ── Step 4: Submit batch ────────────────────────────────────────
  const systemPrompt = loadSystemPrompt();

  const requests = unlabeled.map((c) => ({
    custom_id: c.id,
    params: {
      model: MODEL,
      max_tokens: 256 as const,
      system: systemPrompt,
      messages: [{ role: 'user' as const, content: c.text }],
    },
  }));

  const batch = await anthropic.messages.batches.create({ requests });

  // Store batch_id for retrieval
  stillPending.push(batch.id);
  await db.from('settings').upsert({ key: 'pending_batches', value: stillPending });

  // Update monthly spend
  await db.from('settings').upsert({ key: mk, value: currentSpend + cost });

  result.batchSubmitted = true;
  result.commentsSubmitted = unlabeled.length;
  result.estimatedCostUSD = cost;
  result.budgetRemainingUSD = budgetLimit - currentSpend - cost;

  return result;
}
