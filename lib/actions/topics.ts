'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser, assertAdmin, isDbReady } from '@/lib/auth/session';
import { createVideoFromTopic } from '@/lib/actions/sujets';
import { canSeeTopic } from '@/lib/auth/topic-access';
import { parseVideoId } from '@/lib/video/analyze';

/** « Passer en production » depuis la fiche d'un sujet : crée une vidéo pour le client connecté. */
export async function markTopicProduction(topicId: string) {
  const res = await createVideoFromTopic(topicId);
  if ('error' in res) return { error: res.error };
  revalidatePath(`/topics/${topicId}`);
  return { success: true, videoId: res.videoId, existing: res.existing };
}

/** Relie la vidéo YouTube publiée à la vidéo en cours du client sur ce sujet. */
export async function markTopicPublished(topicId: string, videoUrl: string) {
  // Accepts a full YouTube link (watch, youtu.be, shorts…) or a bare video id.
  const videoId = parseVideoId(videoUrl ?? '');
  if (!videoId) {
    return { error: 'Colle le lien de ta vidéo publiée sur YouTube.' };
  }
  const user = await getSessionUser();
  if (!user) return { error: 'Connecte-toi pour continuer.' };
  if (!(await canSeeTopic(user, topicId))) return { error: 'Sujet introuvable.' };
  const db = createServiceClient();

  const ready = await isDbReady();
  let mineQ = db.from('angles').select('id').eq('topic_id', topicId);
  if (ready) mineQ = mineQ.eq('user_id', user.id);
  const { data: mine } = await mineQ
    .eq('status', 'in_production')
    .limit(1)
    .maybeSingle();

  if (mine) {
    const { error } = await db.from('angles').update({ status: 'published', video_id: videoId }).eq('id', mine.id);
    if (error) return { error: "La vidéo n'a pas pu être marquée publiée. Réessaie." };
  } else {
    const { error } = await db
      .from('angles')
      .insert({ topic_id: topicId, title: 'Vidéo publiée', status: 'published', video_id: videoId, ...(ready ? { user_id: user.id } : {}) });
    if (error) return { error: "La vidéo n'a pas pu être marquée publiée. Réessaie." };
  }

  revalidatePath(`/topics/${topicId}`);
  revalidatePath('/pipeline');
  return { success: true };
}

export async function reviewTopic(
  topicId: string,
  action: 'accept' | 'reject' | 'merge',
  mergeInto?: string,
) {
  await assertAdmin();
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
