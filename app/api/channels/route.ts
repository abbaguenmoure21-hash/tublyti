import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RealYouTubeClient } from '@/lib/youtube/client';
import { z } from 'zod/v4';

const AddChannelSchema = z.object({
  url: z.string().min(1),
  niche_id: z.string().uuid(),
});

export async function GET() {
  const db = await createClient();
  const { data, error } = await db
    .from('channels')
    .select('id, title, subscriber_count, last_checked_at, niche_id, niches(name)')
    .order('last_checked_at', { ascending: true, nullsFirst: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = AddChannelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'URL et niche_id requis.' }, { status: 400 });
  }

  const { url, niche_id } = parsed.data;

  // Parse handle or ID from URL
  const handleMatch = url.match(/@([\w.-]+)/);
  const idMatch = url.match(/channel\/(UC[\w-]+)/);

  const yt = new RealYouTubeClient();
  const db = await createClient();

  try {
    let info;
    if (handleMatch) {
      const results = await yt.resolveHandles([handleMatch[1]]);
      if (results.length === 0)
        return NextResponse.json({ error: 'Chaîne introuvable.' }, { status: 404 });
      info = results[0];
    } else if (idMatch) {
      const results = await yt.getChannels([idMatch[1]]);
      if (results.length === 0)
        return NextResponse.json({ error: 'Chaîne introuvable.' }, { status: 404 });
      info = results[0];
    } else if (url.startsWith('UC')) {
      const results = await yt.getChannels([url]);
      if (results.length === 0)
        return NextResponse.json({ error: 'Chaîne introuvable.' }, { status: 404 });
      info = results[0];
    } else {
      return NextResponse.json(
        { error: "Format non reconnu. Utilisez une URL YouTube ou un ID de chaîne." },
        { status: 400 },
      );
    }

    const { error } = await db.from('channels').upsert({
      id: info.id,
      workspace_id: '00000000-0000-0000-0000-000000000001',
      niche_id,
      title: info.title,
      subscriber_count: info.subscriberCount,
      uploads_playlist_id: info.uploadsPlaylistId,
      last_checked_at: new Date().toISOString(),
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, channel: info });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const db = await createClient();
  const { error } = await db.from('channels').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
