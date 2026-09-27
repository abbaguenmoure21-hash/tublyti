import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

const PatchSchema = z.object({
  label: z.enum([
    'no_one_explains',
    'wish_video_on',
    'stopped_too_early',
    'searched_long',
    'none',
  ]),
  requestedAngle: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const parsed = PatchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = createServiceClient();

  const { error } = await db.from('comment_labels').upsert({
    comment_id: id,
    label: parsed.data.label,
    requested_angle: parsed.data.requestedAngle ?? null,
    confidence: 1.0,
    model: 'human',
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
