import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ClaudeAngleGenerator,
  FakeAngleGenerator,
  estimateAngleCostUSD,
} from '@/lib/nlp/angle-generator';
import type { AngleInput, AngleGenerationResult } from '@/lib/nlp/angle-generator';

/**
 * Generates 5 content angles for a topic and stores them.
 * Shared by the HTTP route (/api/topics/[id]/angles, cron-secret protected),
 * the MCP tool `generate_angles` and the extension action: no internal HTTP
 * round-trip, no secret travelling between our own functions.
 */

export type GenerateAnglesResult =
  | {
      ok: true;
      angles: AngleGenerationResult['angles'];
      model: string;
      costUSD: number;
      budgetRemainingUSD: number;
    }
  | {
      ok: false;
      code: 'not_found' | 'budget_exceeded' | 'generator_error' | 'server_error';
      message: string;
      status: number;
      budgetRemainingUSD?: number;
      estimatedCostUSD?: number;
    };

function monthKey(): string {
  const d = new Date();
  return `ai_spend_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function generateAnglesForTopic(db: SupabaseClient, topicId: string): Promise<GenerateAnglesResult> {
  // ── Load topic ────────────────────────────────────────────────
  const { data: topic, error: topicErr } = await db
    .from('topics')
    .select('id, label, phase, niche_id, niches(name, rpm_coefficient)')
    .eq('id', topicId)
    .single();

  if (topicErr || !topic) {
    return { ok: false, code: 'not_found', message: 'Sujet introuvable.', status: 404 };
  }

  const niche = topic.niches as unknown as {
    name: string;
    rpm_coefficient: number;
  };

  // ── Budget check ──────────────────────────────────────────────
  const estimatedCost = estimateAngleCostUSD();
  const mk = monthKey();
  const { data: spendRow } = await db
    .from('settings')
    .select('value')
    .eq('key', mk)
    .single();
  const currentSpend =
    typeof spendRow?.value === 'number' ? spendRow.value : 0;
  const budgetLimit = parseFloat(process.env.AI_BUDGET_USD ?? '30');

  if (currentSpend + estimatedCost > budgetLimit) {
    return {
      ok: false,
      code: 'budget_exceeded',
      message: 'Budget IA mensuel dépassé.',
      status: 402,
      budgetRemainingUSD: budgetLimit - currentSpend,
      estimatedCostUSD: estimatedCost,
    };
  }

  // ── Load frustrations ─────────────────────────────────────────
  const { data: frustRows } = await db
    .from('comment_labels')
    .select(`
      label, requested_angle, confidence,
      comments!inner(text, like_count, video_id, videos!inner(topic_id))
    `)
    .eq('comments.videos.topic_id', topicId)
    .neq('label', 'none')
    .gte('confidence', 0.7)
    .order('comments(like_count)', { ascending: false })
    .limit(20);

  const frustrations: AngleInput['frustrations'] = (frustRows ?? []).map(
    (f: Record<string, unknown>) => {
      const comment = f.comments as unknown as {
        text: string;
        like_count: number;
      };
      return {
        text: comment.text,
        label: f.label as string,
        requestedAngle: (f.requested_angle as string) ?? null,
        likeCount: comment.like_count,
      };
    },
  );

  // ── Load competitor videos ────────────────────────────────────
  const sixMonthsAgo = new Date(
    Date.now() - 180 * 86_400_000,
  ).toISOString();
  const { data: vids } = await db
    .from('videos')
    .select('title, channels(title)')
    .eq('topic_id', topicId)
    .eq('is_qualified', true)
    .gte('published_at', sixMonthsAgo)
    .order('published_at', { ascending: false })
    .limit(10);

  const competitors: AngleInput['competitors'] = (vids ?? []).map(
    (v: Record<string, unknown>) => ({
      title: v.title as string,
      channelTitle:
        (v.channels as unknown as { title: string })?.title ?? '',
    }),
  );

  // ── Load title patterns for niche ────────────────────────────
  let titlePatterns: AngleInput['titlePatterns'] = [];
  if (topic.niche_id) {
    const { data: patterns } = await db
      .from('title_patterns')
      .select('formula, description, examples')
      .eq('niche_id', topic.niche_id)
      .order('frequency', { ascending: false })
      .limit(10);

    titlePatterns = (patterns ?? []).map((p: Record<string, unknown>) => ({
      formula: p.formula as string,
      description: p.description as string,
      examples: (p.examples as string[]) ?? [],
    }));
  }

  // ── Generate angles ───────────────────────────────────────────
  const generator = process.env.ANTHROPIC_API_KEY
    ? new ClaudeAngleGenerator()
    : new FakeAngleGenerator();

  const input: AngleInput = {
    topicLabel: topic.label as string,
    nicheName: niche.name,
    rpmCoefficient: niche.rpm_coefficient,
    phase: (topic.phase as number) ?? null,
    frustrations,
    competitors,
    titlePatterns,
  };

  let result: AngleGenerationResult;
  try {
    result = await generator.generate(input);
  } catch (err: unknown) {
    console.error('[angles] generation failed:', err);
    return {
      ok: false,
      code: 'generator_error',
      message: 'Le générateur a rencontré une erreur (API ou format de réponse).',
      status: 500,
    };
  }

  // ── Store angles ──────────────────────────────────────────────
  const rows = result.angles.map((a) => ({
    topic_id: topicId,
    title: a.title,
    hook: a.hook,
    rationale: `Formule: ${a.formula}\nFrustration: ${a.frustration_resolved}\n\n${a.rationale}`,
    status: 'idea',
  }));

  const { error: insertErr } = await db.from('angles').insert(rows);
  if (insertErr) {
    console.error('[angles] insert failed:', insertErr);
    return { ok: false, code: 'server_error', message: 'Impossible de sauvegarder les angles.', status: 500 };
  }

  // ── Update monthly AI spend ───────────────────────────────────
  await db
    .from('settings')
    .upsert({ key: mk, value: currentSpend + result.costUSD });

  // Record in ai_spend table for detailed tracking
  await db.from('ai_spend').insert({
    action: 'generate_angles',
    model: result.model,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    cost_usd: result.costUSD,
    topic_id: topicId,
    meta: { topic_label: topic.label, niche: niche.name },
  });

  return {
    ok: true,
    angles: result.angles,
    model: result.model,
    costUSD: result.costUSD,
    budgetRemainingUSD: budgetLimit - currentSpend - result.costUSD,
  };
}
