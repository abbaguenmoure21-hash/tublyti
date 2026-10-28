'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import { outlierSaturation, type OutlierSaturation } from '@/lib/saturation';

/** Vérifie à la demande si l'idée d'une vidéo gagnante a déjà été trop copiée. */
export async function checkOutlierSaturation(videoId: string): Promise<{ ok: true; data: OutlierSaturation } | { ok: false; message: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Connecte-toi.' };
  if (!/^[\w-]{11}$/.test(videoId)) return { ok: false, message: 'Vidéo invalide.' };
  const data = await outlierSaturation(createServiceClient(), videoId).catch(() => null);
  if (!data) return { ok: false, message: 'Pas assez de données sur cette vidéo (titre pas encore analysé).' };
  return { ok: true, data };
}
