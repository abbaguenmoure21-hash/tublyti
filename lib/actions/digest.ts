'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser, isDbReady } from '@/lib/auth/session';
import { buildDigestData } from '@/lib/services/digest';
import { buildDigestHtml, sendDigestEmail } from '@/lib/email/digest-email';
import { sendDigestToUser } from '@/lib/services/digest-send';

/** « M'envoyer le résumé maintenant » : le résumé du compte connecté, à son adresse. */
export async function sendDigestNow() {
  const user = await getSessionUser();
  if (!user) return { error: 'Connecte-toi pour continuer.' };
  const db = createServiceClient();

  try {
    if (!(await isDbReady())) {
      if (user.role !== 'admin') return { error: 'Action indisponible pour le moment.' };
      const data = await buildDigestData(db);
      const result = await sendDigestEmail(buildDigestHtml(data, (process.env.NEXT_PUBLIC_APP_URL || 'https://tublyti.vercel.app').replace(/\/+$/, '')));
      return result.ok ? { success: true } : { error: result.error ?? 'Échec de l’envoi.' };
    }
    const result = await sendDigestToUser(db, { id: user.id, email: user.email, isAdmin: user.role === 'admin' });
    if (!result.ok) return { error: result.error ?? 'Échec de l’envoi.' };
    if (!result.blocks) return { error: 'Rien à résumer pour l’instant.' };
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur inconnue' };
  }
}
