import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const db = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Get today's scores with topic and niche info
  const { data, error } = await db
    .from('topic_scores')
    .select(`
      mgi, demand, frustration, supply_q, monetization, phase,
      topics!inner(id, label, status, niches!inner(id, name))
    `)
    .eq('scored_at', today)
    .order('mgi', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ niches: [] });
  }

  // Group by niche, top 10 per niche
  const PHASE_LABELS: Record<number, string> = {
    0: 'Emergence',
    1: 'Viralite courte',
    2: 'Fenetre ideale',
    3: 'Saturation',
  };

  const byNiche = new Map<string, { nicheName: string; topics: unknown[] }>();

  for (const row of data) {
    const topic = row.topics as unknown as {
      id: string;
      label: string;
      status: string;
      niches: { id: string; name: string };
    };
    const nicheId = topic.niches.id;

    if (!byNiche.has(nicheId)) {
      byNiche.set(nicheId, { nicheName: topic.niches.name, topics: [] });
    }

    const group = byNiche.get(nicheId)!;
    if (group.topics.length < 10) {
      group.topics.push({
        topicId: topic.id,
        label: topic.label,
        status: topic.status,
        mgi: Number(row.mgi),
        demand: Number(row.demand),
        frustration: Number(row.frustration),
        supplyQ: Number(row.supply_q),
        monetization: Number(row.monetization),
        phase: row.phase,
        phaseLabel: PHASE_LABELS[row.phase as number] ?? 'Inconnu',
      });
    }
  }

  return NextResponse.json({
    scoredAt: today,
    niches: [...byNiche.values()],
  });
}
