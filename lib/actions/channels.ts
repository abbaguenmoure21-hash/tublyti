'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';

const AddChannelSchema = z.object({
  url: z.string().min(1),
  niche_id: z.string().uuid(),
});

export async function addChannel(url: string, nicheId: string) {
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
  if (!channelId) return { error: 'ID manquant.' };

  const db = createServiceClient();
  const { error } = await db.from('channels').delete().eq('id', channelId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/channels');
  return { success: true };
}
