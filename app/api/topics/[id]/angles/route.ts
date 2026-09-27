import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  ClaudeAngleGenerator,
  FakeAngleGenerator,
  estimateAngleCostUSD,
} from '@/lib/nlp/angle-generator';
import type { AngleInput } from '@/lib/nlp/angle-generator';

function monthKey(): string {
  const d = new Date();
  return `ai_spend_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
    return NextResponse.json(
      {
        error: 'Budget IA mensuel dépassé.',
        budgetRemainingUSD: budgetLimit - currentSpend,
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
  };

  const result = await generator.generate(input);

  // ── Store angles ──────────────────────────────────────────────
  const rows = result.angles.map((a) => ({
    topic_id: id,
    title: a.title,
    hook: a.hook,
    rationale: a.rationale,
    status: 'idea',
  }));

  const { error: insertErr } = await db.from('angles').insert(rows);
  if (insertErr) {
    return NextResponse.json(
      { error: 'Impossible de sauvegarder les angles.' },
      { status: 500 },
    );
  }

  // ── Update monthly AI spend ───────────────────────────────────
  await db
    .from('settings')
    .upsert({ key: mk, value: currentSpend + result.costUSD });

  // ── Return result ─────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    angles: result.angles,
    model: result.model,
    costUSD: result.costUSD,
    budgetRemainingUSD: budgetLimit - currentSpend - result.costUSD,
  });
}
