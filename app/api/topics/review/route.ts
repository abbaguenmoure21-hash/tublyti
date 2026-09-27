import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

// GET: list proposed topics with their member videos
export async function GET() {
  const db = createServiceClient();

  const { data, error } = await db
    .from('topics')
    .select(`
      id, label, status, phase, created_at,
      niches(name),
      videos(id, title, channel_id, published_at, channels(title))
    `)
    .eq('status', 'proposed')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also fetch active topics for merge targets
  const { data: activeTopics } = await db
    .from('topics')
    .select('id, label, niches(name)')
    .eq('status', 'active');

  return NextResponse.json({
    proposed: data ?? [],
    mergeTargets: activeTopics ?? [],
  });
}

// PATCH: accept, reject, or merge a proposed topic
const PatchSchema = z.object({
  action: z.enum(['accept', 'reject', 'merge']),
  mergeInto: z.string().uuid().optional(),
});

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const topicId = body.topicId;

  if (!topicId || typeof topicId !== 'string') {
    return NextResponse.json({ error: 'topicId requis' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = createServiceClient();
  const { action, mergeInto } = parsed.data;

  switch (action) {
    case 'accept': {
      const { error } = await db
        .from('topics')
        .update({ status: 'active' })
        .eq('id', topicId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }

    case 'reject': {
      // Detach videos from this topic, then mark rejected
      await db.from('videos').update({ topic_id: null }).eq('topic_id', topicId);
      const { error } = await db
        .from('topics')
        .update({ status: 'rejected' })
        .eq('id', topicId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }

    case 'merge': {
      if (!mergeInto) {
        return NextResponse.json(
          { error: 'mergeInto requis pour fusionner' },
          { status: 400 },
        );
      }
      // Move videos to target topic
      await db
        .from('videos')
        .update({ topic_id: mergeInto })
        .eq('topic_id', topicId);
      // Mark as merged
      const { error } = await db
        .from('topics')
        .update({ status: 'merged', merged_into: mergeInto })
        .eq('id', topicId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
