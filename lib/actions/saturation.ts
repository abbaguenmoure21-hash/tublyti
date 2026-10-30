'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import { consumeUserQuota, QUOTA_MESSAGE } from '@/lib/auth/user-quota';
import { accountNicheIds, catalogueVideoInScope, nicheNameInScope, OUT_OF_SCOPE_MESSAGE } from '@/lib/auth/account-scope';
import { parseVideoId } from '@/lib/video/analyze';
import { linkSaturation, outlierSaturation, type LinkSaturation, type OutlierSaturation } from '@/lib/saturation';

/** Vérifie à la demande si l'idée d'une vidéo gagnante a déjà été trop copiée. */
export async function checkOutlierSaturation(videoId: string): Promise<{ ok: true; data: OutlierSaturation } | { ok: false; message: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Connecte-toi.' };
  if (!/^[\w-]{11}$/.test(videoId)) return { ok: false, message: 'Vidéo invalide.' };
  const db = createServiceClient();
  // Same rule as the MCP tool: a client only checks videos of its own themes.
  if (!(await catalogueVideoInScope(db, videoId, await accountNicheIds(db, user)))) return { ok: false, message: OUT_OF_SCOPE_MESSAGE };
  let data: OutlierSaturation | null = null;
  try {
    data = await outlierSaturation(db, videoId);
  } catch (e) {
    console.error('[saturation] outlier check failed', e);
    return { ok: false, message: 'La vérification n’a pas pu être faite. Réessaie dans un instant.' };
  }
  if (!data) return { ok: false, message: 'Pas assez de données sur cette vidéo (titre pas encore analysé).' };
  return { ok: true, data };
}

/** N'importe quel lien YouTube : l'idée est-elle déjà saturée dans sa niche ? */
export async function checkLinkSaturation(link: string): Promise<{ ok: true; data: LinkSaturation } | { ok: false; message: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: 'Connecte-toi.' };
  const db = createServiceClient();
  const input = String(link ?? '').slice(0, 300);
  const scope = await accountNicheIds(db, user);
  // A catalogue video of another theme is refused before spending the quota.
  const videoId = parseVideoId(input);
  if (videoId && !(await catalogueVideoInScope(db, videoId, scope))) return { ok: false, message: OUT_OF_SCOPE_MESSAGE };
  if (!(await consumeUserQuota(db, user, 'link_saturation'))) return { ok: false, message: QUOTA_MESSAGE };
  const r = await linkSaturation(db, input, scope ?? []).catch((e: Error) => ({ error: e.message }));
  if ('error' in r) return { ok: false, message: r.error };
  // Off-catalogue video: its niche is detected over the whole catalogue; it must be one of the account's.
  if (!(await nicheNameInScope(db, r.nicheName, scope))) return { ok: false, message: OUT_OF_SCOPE_MESSAGE };
  return { ok: true, data: r };
}
