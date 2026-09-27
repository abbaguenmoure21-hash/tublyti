import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const db = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const nicheId = request.nextUrl.searchParams.get('niche');

  // Get niches for selector
  const { data: niches } = await db
    .from('niches')
    .select('id, name')
    .eq('status', 'active')
    .order('name');

  // Get today's scores with topic + niche info
  let query = db
    .from('topic_scores')
    .select(`
      mgi, demand, frustration, supply_q, monetization, phase,
      topics!inner(id, label, status, niche_id, niches!inner(id, name))
    `)
    .eq('scored_at', today)
    .order('mgi', { ascending: false });

  if (nicheId) {
    query = query.eq('topics.niche_id', nicheId);
  }

  const { data: scores, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get 30-day trend sparkline data per topic
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const topicIds = (scores ?? []).map((s: Record<string, unknown>) => {
    const t = s.topics as unknown as { id: string };
    return t.id;
  });

  let sparklines: Record<string, number[]> = {};

  if (topicIds.length > 0) {
    const { data: trendPoints } = await db
      .from('trend_points')
      .select('topic_id, captured_at, value')
      .in('topic_id', topicIds)
      .eq('source', 'trends')
      .gte('captured_at', thirtyDaysAgo)
      .order('captured_at', { ascending: true });

    // Group by topic
    const byTopic = new Map<string, number[]>();
    for (const p of trendPoints ?? []) {
      if (!byTopic.has(p.topic_id)) byTopic.set(p.topic_id, []);
      byTopic.get(p.topic_id)!.push(Number(p.value));
    }
    sparklines = Object.fromEntries(byTopic);
  }

  const topics = (scores ?? []).map((s: Record<string, unknown>) => {
    const topic = s.topics as unknown as {
      id: string;
      label: string;
      status: string;
      niche_id: string;
      niches: { id: string; name: string };
    };
    return {
      id: topic.id,
      label: topic.label,
      status: topic.status,
      nicheName: topic.niches.name,
      mgi: Number(s.mgi),
      demand: Number(s.demand),
      frustration: Number(s.frustration),
      supplyQ: Number(s.supply_q),
      monetization: Number(s.monetization),
      phase: s.phase as number,
      sparkline: sparklines[topic.id] ?? [],
    };
  });

  return NextResponse.json({
    niches: niches ?? [],
    topics,
    scoredAt: today,
  });
}
