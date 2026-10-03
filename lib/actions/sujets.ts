'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser, getAdminOrNull, isDbReady } from '@/lib/auth/session';

const Id = z.string().uuid();
const NOT_SIGNED = { error: 'Connecte-toi pour continuer.' } as const;
const NOT_ADMIN = { error: "Cette action est réservée à l'administration." } as const;

function refreshClient() {
  revalidatePath('/sujets');
  revalidatePath('/pipeline');
}

// ─────────────────────────── Actions client ───────────────────────────

/**
 * « Créer cette vidéo » : crée une vidéo dans Mes vidéos (colonne en cours) pour l'utilisateur connecté.
 * Si un angle proposé est choisi, son titre est repris ; l'angle proposé lui-même n'est pas modifié
 * (il est partagé entre tous les clients).
 */
export async function createVideoFromTopic(topicId: string, angleId?: string | null) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  if (!Id.safeParse(topicId).success) return { error: 'Sujet introuvable.' };
  const db = createServiceClient();

  const { data: topic } = await db.from('topics').select('id, label').eq('id', topicId).single();
  if (!topic) return { error: 'Sujet introuvable.' };

  let title = topic.label as string;
  let hook: string | null = null;
  if (angleId && Id.safeParse(angleId).success) {
    const { data: angle } = await db.from('angles').select('title, hook').eq('id', angleId).eq('topic_id', topicId).maybeSingle();
    if (angle?.title) {
      title = angle.title as string;
      hook = (angle.hook as string | null) ?? null;
    }
  }

  const ready = await isDbReady();
  const { data, error } = await db
    .from('angles')
    .insert({ topic_id: topicId, title, hook, status: 'in_production', ...(ready ? { user_id: user.id } : {}) })
    .select('id')
    .single();
  if (error || !data) return { error: "La vidéo n'a pas pu être créée. Réessaie." };
  // Avant la migration 00018 : le statut du sujet sert encore de repère « Dans Mes vidéos ».
  if (!ready) await db.from('topics').update({ status: 'in_production' }).eq('id', topicId).eq('status', 'active');

  refreshClient();
  return { success: true, videoId: data.id as string };
}

/** Annule « Créer cette vidéo ». */
export async function undoCreateVideo(videoId: string) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  if (!Id.safeParse(videoId).success) return { error: 'Action impossible.' };
  const db = createServiceClient();
  let del = db.from('angles').delete().eq('id', videoId);
  if (await isDbReady()) del = del.eq('user_id', user.id);
  await del;
  refreshClient();
  return { success: true };
}

/** Ignorer un sujet : il disparaît de MA liste uniquement. */
export async function ignoreTopic(topicId: string) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  if (!Id.safeParse(topicId).success) return { error: 'Sujet introuvable.' };
  const db = createServiceClient();
  if (!(await isDbReady())) {
    const { error: legacyErr } = await db.from('topics').update({ status: 'rejected' }).eq('id', topicId);
    if (legacyErr) return { error: "Le sujet n'a pas pu être ignoré. Réessaie." };
    refreshClient();
    return { success: true };
  }
  const { error } = await db
    .from('user_topic_state')
    .upsert({ user_id: user.id, topic_id: topicId, state: 'ignored', updated_at: new Date().toISOString() });
  if (error) return { error: "Le sujet n'a pas pu être ignoré. Réessaie." };
  refreshClient();
  return { success: true };
}

/** Annule « Ignorer ». */
export async function unignoreTopic(topicId: string) {
  const user = await getSessionUser();
  if (!user) return NOT_SIGNED;
  if (!Id.safeParse(topicId).success) return { error: 'Sujet introuvable.' };
  const db = createServiceClient();
  if (!(await isDbReady())) {
    await db.from('topics').update({ status: 'active' }).eq('id', topicId);
    refreshClient();
    return { success: true };
  }
  await db.from('user_topic_state').delete().eq('user_id', user.id).eq('topic_id', topicId);
  refreshClient();
  return { success: true };
}

// ─────────────────────── Actions d'administration ───────────────────────

function refreshAdmin() {
  revalidatePath('/admin/sujets');
  revalidatePath('/sujets');
  revalidatePath('/dashboard');
}

/** Tri des sujets proposés : garder (= publier le sujet pour tous les clients). */
export async function keepTopic(topicId: string) {
  if (!(await getAdminOrNull())) return NOT_ADMIN;
  if (!Id.safeParse(topicId).success) return { error: 'Sujet introuvable.' };
  const { error } = await createServiceClient().from('topics').update({ status: 'active' }).eq('id', topicId);
  if (error) return { error: "Le sujet n'a pas pu être gardé. Réessaie." };
  refreshAdmin();
  return { success: true };
}

/** Tri des sujets proposés : rejeter pour tous les clients. */
export async function rejectTopic(topicId: string) {
  if (!(await getAdminOrNull())) return NOT_ADMIN;
  if (!Id.safeParse(topicId).success) return { error: 'Sujet introuvable.' };
  const { error } = await createServiceClient().from('topics').update({ status: 'rejected' }).eq('id', topicId);
  if (error) return { error: "Le sujet n'a pas pu être rejeté. Réessaie." };
  refreshAdmin();
  return { success: true };
}

/** Annule une décision de tri (le sujet redevient « proposé »). */
export async function reproposeTopic(topicId: string) {
  if (!(await getAdminOrNull())) return NOT_ADMIN;
  if (!Id.safeParse(topicId).success) return { error: 'Sujet introuvable.' };
  const { error } = await createServiceClient().from('topics').update({ status: 'proposed' }).eq('id', topicId);
  if (error) return { error: "L'annulation n'a pas fonctionné." };
  refreshAdmin();
  return { success: true };
}

/** Fusionner un sujet proposé dans un sujet existant. */
export async function mergeTopic(topicId: string, intoId: string) {
  if (!(await getAdminOrNull())) return NOT_ADMIN;
  if (!Id.safeParse(topicId).success || !Id.safeParse(intoId).success || topicId === intoId) {
    return { error: 'Choisis un autre sujet pour la fusion.' };
  }
  const db = createServiceClient();
  const { error: moveErr } = await db.from('videos').update({ topic_id: intoId }).eq('topic_id', topicId);
  if (moveErr) return { error: "La fusion n'a pas fonctionné." };
  const { error } = await db.from('topics').update({ status: 'merged' }).eq('id', topicId);
  if (error) return { error: "La fusion n'a pas fonctionné." };
  refreshAdmin();
  return { success: true };
}
