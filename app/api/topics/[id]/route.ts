import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Topic info
  const { data: topic, error } = await db
    .from('topics')
    .select('id, label, phase, status, niches(name, rpm_coefficient)')
    .eq('id', id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  // Today's score
  const { data: score } = await db
    .from('topic_scores')
    .select('mgi, demand, frustration, supply_q, monetization, phase')
    .eq('topic_id', id)
    .eq('scored_at', today)
    .single();

  // Qualified competitor videos
  const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const { data: videos } = await db
    .from('videos')
    .select('id, title, published_at, channel_id, channels(title)')
    .eq('topic_id', id)
    .eq('is_qualified', true)
    .gte('published_at', sixMonthsAgo)
    .order('published_at', { ascending: false })
    .limit(20);

  // Get latest views for these videos
  const videoIds = (videos ?? []).map((v: Record<string, unknown>) => v.id as string);
  let videoViews: Record<string, number> = {};
  if (videoIds.length > 0) {
    const { data: snaps } = await db
      .from('video_snapshots')
      .select('video_id, views')
      .in('video_id', videoIds)
      .order('captured_at', { ascending: false });

    const seen = new Set<string>();
    for (const s of snaps ?? []) {
      if (!seen.has(s.video_id)) {
        seen.add(s.video_id);
        videoViews[s.video_id] = s.views ?? 0;
      }
    }
  }

  // Top 20 frustrated comments
  const { data: frustrations } = await db
    .from('comment_labels')
    .select(`
      label, requested_angle, confidence,
      comments!inner(id, text, like_count, video_id, videos!inner(topic_id))
    `)
    .eq('comments.videos.topic_id', id)
    .neq('label', 'none')
    .gte('confidence', 0.7)
    .order('comments(like_count)', { ascending: false })
    .limit(20);

  // Angles (P10 placeholder)
  const { data: angles } = await db
    .from('angles')
    .select('id, title, hook, rationale, status, video_id, created_at')
    .eq('topic_id', id)
    .order('created_at', { ascending: false });

  return NextResponse.json({
    ...topic,
    score: score ?? null,
    competitors: (videos ?? []).map((v: Record<string, unknown>) => ({
      id: v.id as string,
      title: v.title as string,
      channelTitle: (v.channels as unknown as { title: string })?.title ?? '',
      publishedAt: v.published_at as string,
      views: videoViews[v.id as string] ?? 0,
    })),
    frustrations: (frustrations ?? []).map((f: Record<string, unknown>) => {
      const comment = f.comments as unknown as {
        id: string;
        text: string;
        like_count: number;
      };
      return {
        commentId: comment.id,
        text: comment.text,
        likeCount: comment.like_count,
        label: f.label,
        requestedAngle: f.requested_angle,
        confidence: f.confidence,
      };
    }),
    angles: angles ?? [],
  });
}

// PATCH: update topic status
const StatusSchema = z.object({
  action: z.enum(['mark_production', 'mark_published']),
  videoId: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const parsed = StatusSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = createServiceClient();
  const { action, videoId } = parsed.data;

  if (action === 'mark_production') {
    const { error } = await db
      .from('topics')
      .update({ status: 'in_production' })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (action === 'mark_published') {
    if (!videoId) {
      return NextResponse.json(
        { error: "L'identifiant de la vidéo publiée est requis." },
        { status: 400 },
      );
    }
    const { error } = await db
      .from('topics')
      .update({ status: 'published' })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Link published video to the first angle if one exists
    const { data: firstAngle } = await db
      .from('angles')
      .select('id')
      .eq('topic_id', id)
      .eq('status', 'in_production')
      .limit(1)
      .single();

    if (firstAngle) {
      await db
        .from('angles')
        .update({ status: 'published', video_id: videoId })
        .eq('id', firstAngle.id);
    }
  }

  return NextResponse.json({ ok: true });
}
