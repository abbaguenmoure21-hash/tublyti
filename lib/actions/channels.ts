'use server';

import { assertAdmin } from '@/lib/auth/session';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

const AddChannelSchema = z.object({
  url: z.string().min(1),
  niche_id: z.string().uuid(),
});

export async function addChannel(url: string, nicheId: string) {
  await assertAdmin();
  const parsed = AddChannelSchema.safeParse({ url, niche_id: nicheId });

  if (!parsed.success) {
    return { error: 'URL et niche sont requis.' };
  }

  const db = createServiceClient();

  // Extract channel ID from URL
  let channelId = parsed.data.url.trim();
  const patterns = [
    /youtube\.com\/channel\/(UC[\w-]+)/,
    /youtube\.com\/@([\w-]+)/,
    /youtube\.com\/c\/([\w-]+)/,
  ];

  for (const pattern of patterns) {
    const match = channelId.match(pattern);
    if (match) {
      channelId = match[1];
      break;
    }
  }

  // Check if already exists
  const { data: existing } = await db
    .from('channels')
    .select('id')
    .eq('id', channelId)
    .single();

  if (existing) {
    return { error: 'Cette chaîne est déjà suivie.' };
  }

  const { error } = await db
    .from('channels')
    .insert({ id: channelId, niche_id: parsed.data.niche_id, title: null });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/channels');
  return { success: true };
}

export async function deleteChannel(channelId: string) {
  await assertAdmin();
  if (!channelId) return { error: 'ID manquant.' };

  const db = createServiceClient();
  const { error } = await db.from('channels').delete().eq('id', channelId);

  if (error) {
    // 23503 = foreign key violation: videos still point to this channel.
    if (error.code === '23503') {
      return { error: 'Cette chaîne a encore des vidéos dans le catalogue : elle ne peut pas être supprimée.' };
    }
    return { error: 'La suppression a échoué. Réessaie dans un instant.' };
  }

  revalidatePath('/channels');
  return { success: true };
}

/** What a deletion would remove, shown in the confirmation dialog. */
export async function getChannelImpact(channelId: string): Promise<{ videos: number } | { error: string }> {
  await assertAdmin();
  if (!channelId) return { error: 'Chaîne introuvable.' };
  const db = createServiceClient();
  const { count, error } = await db
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('channel_id', channelId);
  if (error) return { error: 'Impossible de compter les vidéos de cette chaîne.' };
  return { videos: count ?? 0 };
}
