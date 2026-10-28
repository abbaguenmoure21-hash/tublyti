import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import {
  ClaudeAngleGenerator,
  FakeAngleGenerator,
  AngleGenerationError,
  estimateAngleCostUSD,
} from '@/lib/nlp/angle-generator';
import type { AngleInput } from '@/lib/nlp/angle-generator';
import { timingSafeCompare } from '@/lib/auth/timing-safe';
import { reserveAiBudget, settleAiBudget } from '@/lib/ai/budget';

const uuidSchema = z.string().uuid();

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const authHeader = _request.headers.get('authorization');
  if (!timingSafeCompare(authHeader ?? '', `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 });
  }

  const db = createServiceClient();

  // ── Load topic ────────────────────────────────────────────────
  const { data: topic, error: topicErr } = await db
    .from('topics')
    .select('id, label, phase, niches(name, rpm_coefficient)')
    .eq('id', id)
    .single();

  if (topicErr || !topic) {
    return NextResponse.json({ error: 'Sujet introuvable.' }, { status: 404 });
  }

  const niche = topic.niches as unknown as {
    name: string;
    rpm_coefficient: number;
  };

  // ── Budget check (atomic reservation, settled with the real cost below) ──
  const estimatedCost = estimateAngleCostUSD();
  const reservation = await reserveAiBudget(db, estimatedCost);
  if (!reservation.ok) {
    return NextResponse.json(
      {
        error: 'Budget IA mensuel dépassé.',
        budgetRemainingUSD: reservation.remainingUsd,
        estimatedCostUSD: estimatedCost,
      },
      { status: 402 },
    );
  }

  // ── Load frustrations ─────────────────────────────────────────
  const { data: frustRows } = await db
    .from('comment_labels')
    .select(`
      label, requested_angle, confidence,
      comments!inner(text, like_count, video_id, videos!inner(topic_id))
    `)
    .eq('comments.videos.topic_id', id)
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
    .eq('topic_id', id)
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
  const { data: nicheRow } = await db
    .from('topics')
    .select('niche_id')
    .eq('id', id)
    .single();

  let titlePatterns: AngleInput['titlePatterns'] = [];
  if (nicheRow?.niche_id) {
    const { data: patterns } = await db
      .from('title_patterns')
      .select('formula, description, examples')
      .eq('niche_id', nicheRow.niche_id)
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

  let result;
  try {
    result = await generator.generate(input);
  } catch (err: unknown) {
    // Spend already billed by Anthropic (e.g. truncated answer) is kept, otherwise refunded.
    const billed = (err as { costUSD?: number })?.costUSD ?? 0;
    await settleAiBudget(db, reservation, billed).catch(() => undefined);
    console.error('Erreur lors de la generation des angles:', err);
    return NextResponse.json(
      {
        error:
          err instanceof AngleGenerationError
            ? err.message
            : 'Le générateur a rencontré une erreur (API ou format de réponse).',
      },
      { status: 500 }
    );
  }

  await settleAiBudget(db, reservation, result.costUSD);

  // Record in ai_spend table for detailed tracking
  await db.from('ai_spend').insert({
    action: 'generate_angles',
    model: result.model,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    cost_usd: result.costUSD,
    topic_id: id,
    meta: { topic_label: topic.label, niche: niche.name },
  });

  // ── Store angles ──────────────────────────────────────────────
  const rows = result.angles.map((a) => ({
    topic_id: id,
    title: a.title,
    hook: a.hook,
    rationale: `Formule: ${a.formula}\nFrustration: ${a.frustration_resolved}\n\n${a.rationale}`,
    status: 'idea',
  }));

  const { error: insertErr } = await db.from('angles').insert(rows);
  if (insertErr) {
    return NextResponse.json(
      { error: 'Impossible de sauvegarder les angles.' },
      { status: 500 },
    );
  }

  // ── Return result ─────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    angles: result.angles,
    model: result.model,
    costUSD: result.costUSD,
    budgetRemainingUSD: reservation.remainingUsd - result.costUSD,
  });
}
