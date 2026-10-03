'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser, isDbReady } from '@/lib/auth/session';

const NOT_SIGNED = { error: 'Connecte-toi pour continuer.' } as const;

/** Filtre « mes vidéos » (avant la migration 00018, la colonne user_id n'existe pas encore). */
async function ownedBy(userId: string, angleId: string): Promise<[string, string]> {
  return (await isDbReady()) ? ['user_id', userId] : ['id', angleId];
}

export async function moveAngleToProduction(angleId: string) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const db = createServiceClient();

  // Chaque client ne déplace que ses propres vidéos ; le statut du sujet (commun) n'est pas modifié.
  const { data, error } = await db
    .from('angles')
    .update({ status: 'in_production' })
    .eq('id', angleId)
    .eq(...(await ownedBy(user.id, angleId)))
    .select('id');

  if (error) return { error: error.message };
  if (!data?.length) return { error: 'Vidéo introuvable.' };

  revalidatePath('/pipeline');
  revalidatePath('/dashboard');
  revalidatePath('/today');
  return { success: true };
}

export async function moveAngleToIdea(angleId: string) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const db = createServiceClient();

  const { error } = await db
    .from('angles')
    .update({ status: 'idea' })
    .eq('id', angleId)
    .eq(...(await ownedBy(user.id, angleId)));

  if (error) return { error: error.message };

  revalidatePath('/pipeline');
  return { success: true };
}

export async function publishAngle(angleId: string, videoId: string) {
  if (!videoId?.trim()) {
    return { error: "L'identifiant de la vidéo YouTube est requis." };
  }

  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  const db = createServiceClient();

  const { data: angle } = await db
    .from('angles')
    .select('id, topic_id')
    .eq('id', angleId)
    .eq(...(await ownedBy(user.id, angleId)))
    .single();

  if (!angle) return { error: 'Vidéo introuvable.' };

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
    .eq('id', angleId)
    .eq(...(await ownedBy(user.id, angleId)));

  if (error) return { error: error.message };

  revalidatePath('/pipeline');
  revalidatePath('/dashboard');
  revalidatePath('/today');
  revalidatePath(`/topics/${angle.topic_id}`);
  return { success: true };
}
