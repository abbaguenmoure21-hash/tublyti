'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import { consumeUserQuota, QUOTA_MESSAGE } from '@/lib/auth/user-quota';
import { linkSaturation, outlierSaturation, type LinkSaturation, type OutlierSaturation } from '@/lib/saturation';

/** Vérifie à la demande si l'idée d'une vidéo gagnante a déjà été trop copiée. */
export async function checkOutlierSaturation(videoId: string): Promise<{ ok: true; data: OutlierSaturation } | { ok: false; message: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Connecte-toi.' };
  if (!/^[\w-]{11}$/.test(videoId)) return { ok: false, message: 'Vidéo invalide.' };
  let data: OutlierSaturation | null = null;
  try {
    data = await outlierSaturation(createServiceClient(), videoId);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  if (!data) return { ok: false, message: 'Pas assez de données sur cette vidéo (titre pas encore analysé).' };
  return { ok: true, data };
}

/** N'importe quel lien YouTube : l'idée est-elle déjà saturée dans sa niche ? */
export async function checkLinkSaturation(link: string): Promise<{ ok: true; data: LinkSaturation } | { ok: false; message: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Connecte-toi.' };
  const db = createServiceClient();
  if (!(await consumeUserQuota(db, user, 'link_saturation'))) return { ok: false, message: QUOTA_MESSAGE };
  const { data: mine } = await db.from('user_channels').select('niche_id').eq('user_id', user.id).not('verified_at', 'is', null);
  const prefer = ((mine ?? []) as { niche_id: string | null }[]).map((c) => c.niche_id).filter((x): x is string => Boolean(x));
  const r = await linkSaturation(db, String(link ?? '').slice(0, 300), prefer).catch((e: Error) => ({ error: e.message }));
  if ('error' in r) return { ok: false, message: r.error };
  return { ok: true, data: r };
}
