'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';

export async function markTopicProduction(topicId: string) {
  const db = createServiceClient();

  const { error } = await db
    .from('topics')
    .update({ status: 'in_production' })
    .eq('id', topicId);

  if (error) return { error: error.message };

  revalidatePath(`/topics/${topicId}`);
  revalidatePath('/dashboard');
  revalidatePath('/today');
  return { success: true };
}

export async function markTopicPublished(topicId: string, videoId: string) {
  if (!videoId?.trim()) {
    return { error: "L'identifiant de la vidéo publiée est requis." };
  }

  const db = createServiceClient();

  const { error } = await db
    .from('topics')
    .update({ status: 'published' })
    .eq('id', topicId);

  if (error) return { error: error.message };

  // Link published video to the first in_production angle
  const { data: firstAngle } = await db
    .from('angles')
    .select('id')
    .eq('topic_id', topicId)
    .eq('status', 'in_production')
    .limit(1)
    .single();

  if (firstAngle) {
    await db
      .from('angles')
      .update({ status: 'published', video_id: videoId })
      .eq('id', firstAngle.id);
  }

  revalidatePath(`/topics/${topicId}`);
  revalidatePath('/dashboard');
  revalidatePath('/today');
  return { success: true };
}

export async function reviewTopic(
  topicId: string,
  action: 'accept' | 'reject' | 'merge',
  mergeInto?: string,
) {
  const db = createServiceClient();

  if (action === 'accept') {
    const { error } = await db
      .from('topics')
      .update({ status: 'active' })
      .eq('id', topicId);
    if (error) return { error: error.message };
  } else if (action === 'reject') {
    const { error } = await db
      .from('topics')
      .update({ status: 'rejected' })
      .eq('id', topicId);
    if (error) return { error: error.message };
  } else if (action === 'merge') {
    if (!mergeInto) return { error: 'Cible de fusion manquante.' };

    // Move videos to target topic
    const { error: moveErr } = await db
      .from('videos')
      .update({ topic_id: mergeInto })
      .eq('topic_id', topicId);
    if (moveErr) return { error: moveErr.message };

    // Mark as merged
    const { error: mergeErr } = await db
      .from('topics')
      .update({ status: 'merged' })
      .eq('id', topicId);
    if (mergeErr) return { error: mergeErr.message };
  }

  revalidatePath('/topics/review');
  revalidatePath('/dashboard');
  revalidatePath('/today');
  return { success: true };
}
