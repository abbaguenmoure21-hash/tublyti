'use server';

import { assertAdmin } from '@/lib/auth/session';

import { createServiceClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function followCandidate(candidateId: string, nicheId: string) {
  await assertAdmin();
  const db = createServiceClient();

  // Get candidate info
  const { data: candidate } = await db
    .from('candidate_channels')
    .select('id, title, subscriber_count')
    .eq('id', candidateId)
    .single();

  if (!candidate) return { error: 'Chaîne candidate introuvable.' };

  // Fetch full channel info from YouTube if needed
  const apiKey = process.env.YOUTUBE_API_KEY;
  let uploadsPlaylistId: string | null = null;

  if (apiKey) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(candidateId)}&key=${apiKey}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (res.ok) {
        const data = await res.json();
        uploadsPlaylistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
      }
    } catch {
      // Non-blocking — will be fetched during next collect
    }
  }

  // Insert into channels
  const { error: insertErr } = await db.from('channels').upsert({
    id: candidateId,
    workspace_id: '00000000-0000-0000-0000-000000000001',
    niche_id: nicheId,
    title: candidate.title,
    subscriber_count: candidate.subscriber_count,
    uploads_playlist_id: uploadsPlaylistId,
  }, { onConflict: 'id' });

  if (insertErr) return { error: insertErr.message };

  // Mark candidate as followed
  await db.from('candidate_channels')
    .update({ status: 'followed' })
    .eq('id', candidateId);

  revalidatePath('/channels/candidates');
  revalidatePath('/channels');
  return { ok: true };
}

export async function ignoreCandidate(candidateId: string) {
  await assertAdmin();
  const db = createServiceClient();

  const { error } = await db.from('candidate_channels')
    .update({ status: 'ignored' })
    .eq('id', candidateId);

  if (error) return { error: error.message };

  revalidatePath('/channels/candidates');
  return { ok: true };
}
