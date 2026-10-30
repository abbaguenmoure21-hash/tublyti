import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { reserveAiBudget, settleAiBudget } from '../ai/budget';
import { HAIKU_45_BATCH, costUsd } from '../ai/pricing';

// ── Constants ────────────────────────────────────────────────────────
const PROMPT_VERSION = 'title_patterns_v1';
const MODEL = 'claude-haiku-4-5-20251001';
const MODEL_TAG = `haiku-4.5-${PROMPT_VERSION}`;

// Batch API pricing (50% off standard Haiku 4.5)
const EST_INPUT_TOKENS = 1500;
const EST_OUTPUT_TOKENS = 800;

// ── Types ────────────────────────────────────────────────────────────

interface TitlePatternRaw {
  formula: string;
  description: string;
  examples: string[];
  frequency: number;
  emotional_triggers: string[];
  avg_length: number;
}

export interface ExtractResult {
  batchSubmitted: boolean;
  batchesRetrieved: number;
  patternsStored: number;
  estimatedCostUSD: number;
  skippedBudget: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

function loadSystemPrompt(): string {
  return readFileSync(
    join(process.cwd(), 'lib/nlp/prompts/title_patterns_v1.md'),
    'utf-8',
  );
}


// ── Pending batches ─────────────────────────────────────────────────

/** Pending batch: id, submission time and the amount reserved in the monthly budget. */
export interface PendingBatch {
  id: string;
  at: string | null;
  est: number | null;
}

/** Accepts the legacy format (plain ids) and the new one. */
export function parsePending(value: unknown): PendingBatch[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v): PendingBatch | null => {
      if (typeof v === 'string') return { id: v, at: null, est: null };
      if (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') {
        const o = v as { id: string; at?: unknown; est?: unknown };
        return { id: o.id, at: typeof o.at === 'string' ? o.at : null, est: Number(o.est) >= 0 ? Number(o.est) : null };
      }
      return null;
    })
    .filter((x): x is PendingBatch => x !== null);
}

/** A batch still pending after 48 h is abandoned (it used to block new submissions forever). */
export const PENDING_MAX_MS = 48 * 3_600_000;

// ── Main service ────────────────────────────────────────────────────

export async function extractTitlePatterns(
  db: SupabaseClient,
): Promise<ExtractResult> {
  const result: ExtractResult = {
    batchSubmitted: false,
    batchesRetrieved: 0,
    patternsStored: 0,
    estimatedCostUSD: 0,
    skippedBudget: false,
  };

  const anthropic = new Anthropic();

  // ── 1. Retrieve pending batches ────────────────────────────────
  const { data: pendingRow } = await db
    .from('settings')
    .select('value')
    .eq('key', 'pending_title_pattern_batches')
    .maybeSingle();

  const pendingBatches = parsePending(pendingRow?.value);
  const stillPending: PendingBatch[] = [];

  for (const pending of pendingBatches) {
    const batchId = pending.id;
    try {
      const batch = await anthropic.messages.batches.retrieve(batchId);

      if (batch.processing_status === 'ended') {
        result.batchesRetrieved++;
        let realCost = 0;

        for await (const entry of await anthropic.messages.batches.results(batchId)) {
          if (entry.result.type !== 'succeeded') continue;

          const message = entry.result.message;
          const nicheId = entry.custom_id;
          // Billed whatever the content: counted first.
          const inputTokens = message.usage.input_tokens;
          const outputTokens = message.usage.output_tokens;
          const cost = costUsd(HAIKU_45_BATCH, inputTokens, outputTokens);
          realCost += cost;
          await db.from('ai_spend').insert({
            action: 'extract_title_patterns',
            model: MODEL_TAG,
            tokens_in: inputTokens,
            tokens_out: outputTokens,
            cost_usd: cost,
            meta: { niche_id: nicheId },
          });

          const textBlock = message.content.find((c: { type: string }) => c.type === 'text');
          if (!textBlock || textBlock.type !== 'text') continue;

          let jsonText = textBlock.text.trim();
          const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fenceMatch) jsonText = fenceMatch[1].trim();

          let patterns: TitlePatternRaw[];
          try {
            patterns = JSON.parse(jsonText) as TitlePatternRaw[];
          } catch {
            console.warn(`[TitlePatterns] Failed to parse response for niche ${nicheId}`);
            continue;
          }

          if (!Array.isArray(patterns)) continue;

          const computedAt = new Date().toISOString();
          const rows = patterns.slice(0, 10).map((p) => ({
            niche_id: nicheId,
            formula: String(p.formula ?? 'unknown').slice(0, 50),
            description: String(p.description ?? '').slice(0, 500),
            examples: (p.examples ?? []).map((e) => String(e).slice(0, 200)),
            frequency: Math.max(0, Number(p.frequency) || 0),
            emotional_triggers: (p.emotional_triggers ?? []).map((t) => String(t)),
            avg_length: p.avg_length ? Math.round(Number(p.avg_length)) : null,
            computed_at: computedAt,
          }));

          if (rows.length > 0) {
            // Insert the new formulas first, then remove the older ones: a failed insert
            // no longer leaves the niche without formulas.
            const { error: insErr } = await db.from('title_patterns').insert(rows);
            if (insErr) {
              console.error(`[TitlePatterns] insert failed for niche ${nicheId}: ${insErr.message}`);
              continue;
            }
            await db.from('title_patterns').delete().eq('niche_id', nicheId).lt('computed_at', computedAt);
            result.patternsStored += rows.length;
          }
        }
        // Monthly counter: replace the reserved estimate by the real cost.
        if (pending.est !== null) {
          await settleAiBudget(db, { ok: true, reservedUsd: pending.est, remainingUsd: 0 }, realCost).catch(() => undefined);
        }
      } else if (pending.at && Date.now() - new Date(pending.at).getTime() > PENDING_MAX_MS) {
        console.warn(`[TitlePatterns] batch ${batchId} pending for more than 48 h: abandoned`);
        await anthropic.messages.batches.cancel(batchId).catch(() => undefined);
      } else {
        stillPending.push(pending.at ? pending : { ...pending, at: new Date().toISOString() });
      }
    } catch (err) {
      console.error(`[TitlePatterns] Error retrieving batch ${batchId}:`, err);
      if (pending.at && Date.now() - new Date(pending.at).getTime() > PENDING_MAX_MS) {
        console.warn(`[TitlePatterns] batch ${batchId} unreadable for more than 48 h: abandoned`);
      } else {
        // Legacy entries get a timestamp now, so they expire too.
        stillPending.push(pending.at ? pending : { ...pending, at: new Date().toISOString() });
      }
    }
  }

  // ── 2. Submit new batch if no pending ones ─────────────────────
  if (stillPending.length === 0) {
    const { data: niches } = await db
      .from('niches')
      .select('id, name')
      .eq('status', 'active');

    if (niches && niches.length > 0) {
      const systemPrompt = loadSystemPrompt();
      const requests: Anthropic.Messages.BatchCreateParams.Request[] = [];

      for (const niche of niches) {
        // Winners of THIS niche only, filtered in the database (the old global query was cut
        // at 1 000 rows, so niches outside the global top never got formulas).
        const { data: outlierVideos, error: outErr } = await db
          .from('video_outliers')
          .select('score, videos!inner(title, topic_id, topics!inner(niche_id))')
          .eq('videos.topics.niche_id', niche.id)
          .gte('score', 3)
          .order('score', { ascending: false })
          .limit(50);
        if (outErr) {
          console.error(`[TitlePatterns] outliers for niche ${niche.id}: ${outErr.message}`);
          continue;
        }

        const nicheOutliers = outlierVideos ?? [];
        if (nicheOutliers.length < 5) continue; // Need at least 5 outlier titles

        const titles = nicheOutliers.map((o) => {
          const video = o.videos as unknown as { title: string };
          return `- [${Number(o.score).toFixed(1)}×] ${video.title}`;
        });

        requests.push({
          custom_id: niche.id,
          params: {
            model: MODEL,
            max_tokens: 1500,
            system: systemPrompt,
            messages: [{
              role: 'user',
              content: `## Niche : ${niche.name}\n\n## Titres de videos outliers (score ≥ 3×)\n\n${titles.join('\n')}`,
            }],
          },
        });
      }

      if (requests.length > 0) {
        // Budget reserved for the requests actually sent (not for every active niche).
        const estCost = costUsd(HAIKU_45_BATCH, requests.length * EST_INPUT_TOKENS, requests.length * EST_OUTPUT_TOKENS);
        const reservation = await reserveAiBudget(db, estCost);
        if (!reservation.ok) {
          result.skippedBudget = true;
          result.estimatedCostUSD = estCost;
        } else {
          let submitted = false;
          try {
            const batch = await anthropic.messages.batches.create({ requests });
            submitted = true;
            stillPending.push({ id: batch.id, at: new Date().toISOString(), est: estCost });
            result.batchSubmitted = true;
            result.estimatedCostUSD = estCost;
          } finally {
            if (!submitted) await settleAiBudget(db, reservation, 0).catch(() => undefined);
          }
        }
      }
    }
  }

  // Save pending batches
  await db.from('settings').upsert({ key: 'pending_title_pattern_batches', value: stillPending });

  return result;
}
