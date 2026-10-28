import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { reserveAiBudget, settleAiBudget } from '../ai/budget';

// ── Constants ────────────────────────────────────────────────────────
const PROMPT_VERSION = 'title_patterns_v1';
const MODEL = 'claude-haiku-4-5-20251001';
const MODEL_TAG = `haiku-4.5-${PROMPT_VERSION}`;

// Batch API pricing (50% off standard Haiku 4.5)
const INPUT_COST_PER_MTOK = 0.5; // Haiku 4.5 Batch ($1 / $5 standard, -50 %)
const OUTPUT_COST_PER_MTOK = 2.5;
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
    .single();

  const pendingBatches = Array.isArray(pendingRow?.value) ? (pendingRow.value as string[]) : [];
  const stillPending: string[] = [];

  for (const batchId of pendingBatches) {
    try {
      const batch = await anthropic.messages.batches.retrieve(batchId);

      if (batch.processing_status === 'ended') {
        result.batchesRetrieved++;

        for await (const entry of await anthropic.messages.batches.results(batchId)) {
          if (entry.result.type !== 'succeeded') continue;

          const message = entry.result.message;
          const textBlock = message.content.find((c: { type: string }) => c.type === 'text');
          if (!textBlock || textBlock.type !== 'text') continue;

          // Parse niche_id from custom_id
          const nicheId = entry.custom_id;

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

          // Delete old patterns for this niche
          await db.from('title_patterns').delete().eq('niche_id', nicheId);

          // Insert new patterns
          const rows = patterns.slice(0, 10).map((p) => ({
            niche_id: nicheId,
            formula: String(p.formula ?? 'unknown').slice(0, 50),
            description: String(p.description ?? '').slice(0, 500),
            examples: (p.examples ?? []).map((e) => String(e).slice(0, 200)),
            frequency: Math.max(0, Number(p.frequency) || 0),
            emotional_triggers: (p.emotional_triggers ?? []).map((t) => String(t)),
            avg_length: p.avg_length ? Math.round(Number(p.avg_length)) : null,
            computed_at: new Date().toISOString(),
          }));

          if (rows.length > 0) {
            await db.from('title_patterns').insert(rows);
            result.patternsStored += rows.length;
          }

          // Track cost
          const inputTokens = message.usage.input_tokens;
          const outputTokens = message.usage.output_tokens;
          const cost =
            (inputTokens * INPUT_COST_PER_MTOK) / 1_000_000 +
            (outputTokens * OUTPUT_COST_PER_MTOK) / 1_000_000;

          await db.from('ai_spend').insert({
            action: 'extract_title_patterns',
            model: MODEL_TAG,
            tokens_in: inputTokens,
            tokens_out: outputTokens,
            cost_usd: cost,
            meta: { niche_id: nicheId },
          });
        }
      } else {
        stillPending.push(batchId);
      }
    } catch (err) {
      console.error(`[TitlePatterns] Error retrieving batch ${batchId}:`, err);
      stillPending.push(batchId);
    }
  }

  // ── 2. Submit new batch if no pending ones ─────────────────────
  if (stillPending.length === 0) {
    // Get active niches
    const { data: niches } = await db
      .from('niches')
      .select('id, name')
      .eq('status', 'active');

    if (niches && niches.length > 0) {
      // Budget check
      const nicheCount = niches.length;
      const estCost =
        (nicheCount * EST_INPUT_TOKENS * INPUT_COST_PER_MTOK) / 1_000_000 +
        (nicheCount * EST_OUTPUT_TOKENS * OUTPUT_COST_PER_MTOK) / 1_000_000;

      // Atomic reservation, refunded below if nothing is submitted.
      const reservation = await reserveAiBudget(db, estCost);

      if (!reservation.ok) {
        result.skippedBudget = true;
        result.estimatedCostUSD = estCost;
      } else {
        const systemPrompt = loadSystemPrompt();
        const requests: Anthropic.Messages.BatchCreateParams.Request[] = [];

        for (const niche of niches) {
          // Get outlier titles for this niche (score >= 3)
          const { data: outlierVideos } = await db
            .from('video_outliers')
            .select('score, videos!inner(title, topic_id, topics!inner(niche_id))')
            .gte('score', 3)
            .order('score', { ascending: false });

          const nicheOutliers = (outlierVideos ?? []).filter((o) => {
            const video = o.videos as unknown as { topics: { niche_id: string } };
            return video.topics.niche_id === niche.id;
          });

          if (nicheOutliers.length < 5) continue; // Need at least 5 outlier titles

          const titles = nicheOutliers.map((o) => {
            const video = o.videos as unknown as { title: string };
            return `- [${Number(o.score).toFixed(1)}×] ${video.title}`;
          }).slice(0, 50); // Max 50 titles

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

        let submitted = false;
        try {
          if (requests.length > 0) {
            const batch = await anthropic.messages.batches.create({ requests });
            submitted = true;
            stillPending.push(batch.id);
            result.batchSubmitted = true;
            result.estimatedCostUSD = estCost;
          }
        } finally {
          if (!submitted) await settleAiBudget(db, reservation, 0).catch(() => undefined);
        }
      }
    }
  }

  // Save pending batches
  await db.from('settings').upsert({ key: 'pending_title_pattern_batches', value: stillPending });

  return result;
}
