'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';

export async function moveAngleToProduction(angleId: string) {
  const db = createServiceClient();

  const { data: angle } = await db
    .from('angles')
    .select('id, topic_id')
    .eq('id', angleId)
    .single();

  if (!angle) return { error: 'Angle introuvable.' };

  const { error } = await db
    .from('angles')
    .update({ status: 'in_production' })
    .eq('id', angleId);

  if (error) return { error: error.message };

  // Also update the topic status
  await db
    .from('topics')
    .update({ status: 'in_production' })
    .eq('id', angle.topic_id);

  revalidatePath('/pipeline');
  revalidatePath('/dashboard');
  revalidatePath('/today');
  return { success: true };
}

export async function moveAngleToIdea(angleId: string) {
  const db = createServiceClient();

  const { error } = await db
    .from('angles')
    .update({ status: 'idea' })
    .eq('id', angleId);

  if (error) return { error: error.message };

  revalidatePath('/pipeline');
  return { success: true };
}

export async function publishAngle(angleId: string, videoId: string) {
  if (!videoId?.trim()) {
    return { error: "L'identifiant de la vidéo YouTube est requis." };
  }

  const db = createServiceClient();

  const { data: angle } = await db
    .from('angles')
    .select('id, topic_id')
    .eq('id', angleId)
    .single();

  if (!angle) return { error: 'Angle introuvable.' };

  // Validate the video ID via YouTube API (1 quota unit)
  const ytKey = process.env.YOUTUBE_API_KEY;
  if (ytKey) {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=id&id=${encodeURIComponent(videoId.trim())}&key=${ytKey}`,
    );
    const data = await res.json();
    if (!data.items?.length) {
      return { error: 'Vidéo YouTube introuvable. Vérifie l\'identifiant.' };
    }
  }

  const { error } = await db
    .from('angles')
    .update({ status: 'published', video_id: videoId.trim() })
    .eq('id', angleId);

  if (error) return { error: error.message };

  // Also update the topic status
  await db
    .from('topics')
    .update({ status: 'published' })
    .eq('id', angle.topic_id);

  revalidatePath('/pipeline');
  revalidatePath('/dashboard');
  revalidatePath('/today');
  revalidatePath(`/topics/${angle.topic_id}`);
  return { success: true };
}
