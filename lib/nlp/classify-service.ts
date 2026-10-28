import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FrustrationLabel } from './classifier';
import { reserveAiBudget, settleAiBudget } from '../ai/budget';
import { HAIKU_45_BATCH, costUsd } from '../ai/pricing';

// ── Constants ────────────────────────────────────────────────────────
const PROMPT_VERSION = 'classify_v1';
const MODEL = 'claude-haiku-4-5-20251001';
const MODEL_TAG = `haiku-4.5-${PROMPT_VERSION}`;
const BATCH_SIZE = 500;

// Batch API pricing (50% off standard Haiku 4.5: $1 / $5 per MTok)
const EST_INPUT_TOKENS = 700; // system prompt + comment (comment text capped at MAX_COMMENT_CHARS)
const MAX_COMMENT_CHARS = 1_500;
/** Model tag stored when the answer could not be read: the comment is not sent again. */
const UNPARSABLE_TAG = `${MODEL_TAG}-unparsable`;
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
  return costUsd(HAIKU_45_BATCH, commentCount * EST_INPUT_TOKENS, commentCount * EST_OUTPUT_TOKENS);
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
  // Amount reserved per batch at submission (separate key: pending_batches stays a list of ids,
  // as read by scripts/retrieve-batches.ts).
  const { data: estRow } = await db.from('settings').select('value').eq('key', 'pending_batches_est').maybeSingle();
  const estByBatch: Record<string, number> = { ...((estRow?.value as Record<string, number> | null) ?? {}) };
  let estChanged = false;

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
        let tokensIn = 0;
        let tokensOut = 0;
        for await (const item of resultsStream) {
          if (item.result.type === 'succeeded') {
            tokensIn += item.result.message.usage?.input_tokens ?? 0;
            tokensOut += item.result.message.usage?.output_tokens ?? 0;
            const content = item.result.message.content[0];
            if (content.type === 'text') {
              try {
                // Strip markdown code fences if present
                let jsonText = content.text.trim();
                const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (fenceMatch) jsonText = fenceMatch[1].trim();

                const parsed = JSON.parse(jsonText);
                const label = parseLabel(parsed.label);
                if (!label) throw new Error('unknown label');

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
                // Unreadable answer (already billed): store a neutral label so the
                // comment is not re-sent (and re-billed) every night.
                await db.from('comment_labels').upsert({
                  comment_id: item.custom_id,
                  label: 'none',
                  requested_angle: null,
                  confidence: 0,
                  model: UNPARSABLE_TAG,
                });
              }
            }
          }
        }
        result.batchesRetrieved++;
        // Real cost from usage: one ai_spend row per batch, and the monthly counter adjusted
        // from the reserved estimate to the real amount.
        const realCost = costUsd(HAIKU_45_BATCH, tokensIn, tokensOut);
        await db.from('ai_spend').insert({
          action: 'classify_comments',
          model: MODEL_TAG,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: realCost,
          meta: { batch_id: batchId },
        });
        const est = estByBatch[batchId];
        if (typeof est === 'number') {
          await settleAiBudget(db, { ok: true, reservedUsd: est, remainingUsd: 0 }, realCost).catch(() => undefined);
          delete estByBatch[batchId];
          estChanged = true;
        }
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
  if (estChanged) await db.from('settings').upsert({ key: 'pending_batches_est', value: estByBatch });

  if (isTimedOut()) return result;

  // ── Step 2: Find unlabeled comments ─────────────────────────────
  const unlabeled = await findUnlabeled(db, BATCH_SIZE);

  if (unlabeled.length === 0) return result;

  // ── Step 3: Budget check ────────────────────────────────────────
  if (isTimedOut()) return result;
  const cost = estimateCostUSD(unlabeled.length);
  // Atomic reservation: kept as the month's spend once the batch is submitted.
  const reservation = await reserveAiBudget(db, cost);
  result.budgetRemainingUSD = reservation.remainingUsd;

  if (!reservation.ok) {
    result.skippedBudget = true;
    result.estimatedCostUSD = cost;
    return result;
  }

  // ── Step 4: Submit batch ────────────────────────────────────────
  const systemPrompt = loadSystemPrompt();

  const requests = unlabeled.map((c) => ({
    custom_id: c.id,
    params: {
      model: MODEL,
      max_tokens: 256 as const,
      system: systemPrompt,
      messages: [{ role: 'user' as const, content: String(c.text ?? '').slice(0, MAX_COMMENT_CHARS) }],
    },
  }));

  let batch;
  try {
    batch = await anthropic.messages.batches.create({ requests });
  } catch (err) {
    await settleAiBudget(db, reservation, 0).catch(() => undefined);
    throw err;
  }

  // Store batch_id for retrieval
  stillPending.push(batch.id);
  await db.from('settings').upsert({ key: 'pending_batches', value: stillPending });
  estByBatch[batch.id] = cost;
  await db.from('settings').upsert({ key: 'pending_batches_est', value: estByBatch });

  result.batchSubmitted = true;
  result.commentsSubmitted = unlabeled.length;
  result.estimatedCostUSD = cost;
  result.budgetRemainingUSD = reservation.remainingUsd - cost;

  return result;
}

/**
 * Most-liked comments without a label. Uses the `unlabeled_comments` RPC (anti-join
 * in the database, migration 00034); falls back to paging when it is not applied yet.
 */
export async function findUnlabeled(
  db: SupabaseClient,
  limit: number,
): Promise<{ id: string; text: string }[]> {
  const { data, error } = await db.rpc('unlabeled_comments', { p_limit: limit });
  if (!error) return (data ?? []) as { id: string; text: string }[];
  const missing = error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message);
  if (!missing) throw new Error(`Lecture des commentaires à classer impossible : ${error.message}`);

  // Fallback: page through comments by likes (1 000 rows max per call) and keep unlabeled ones.
  const PAGE = 1000;
  const out: { id: string; text: string }[] = [];
  for (let offset = 0; out.length < limit && offset < 200_000; offset += PAGE) {
    const { data: page, error: e1 } = await db
      .from('comments')
      .select('id, text')
      .order('like_count', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (e1) throw new Error(`Lecture des commentaires impossible : ${e1.message}`);
    if (!page || page.length === 0) break;
    const ids = page.map((c) => c.id as string);
    const labeled = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: lab, error: e2 } = await db
        .from('comment_labels')
        .select('comment_id')
        .in('comment_id', ids.slice(i, i + 200));
      if (e2) throw new Error(`Lecture des étiquettes impossible : ${e2.message}`);
      for (const r of lab ?? []) labeled.add(r.comment_id as string);
    }
    for (const c of page) if (!labeled.has(c.id as string)) out.push({ id: c.id as string, text: c.text as string });
    if (page.length < PAGE) break;
  }
  return out.slice(0, limit);
}
