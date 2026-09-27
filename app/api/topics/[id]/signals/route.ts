import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = createServiceClient();

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await db
    .from('trend_points')
    .select('source, captured_at, value')
    .eq('topic_id', id)
    .gte('captured_at', ninetyDaysAgo)
    .order('captured_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group by source
  const series: Record<string, { date: string; value: number }[]> = {
    trends: [],
    reddit: [],
    hn: [],
    yt_views: [],
  };

  for (const point of data ?? []) {
    const source = point.source as string;
    if (source in series) {
      series[source].push({
        date: point.captured_at,
        value: point.value,
      });
    }
  }

  return NextResponse.json(series);
}
