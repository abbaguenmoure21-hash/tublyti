'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { buildDigestData } from '@/lib/services/digest';
import { buildDigestHtml, sendDigestEmail } from '@/lib/email/digest-email';

export async function sendDigestNow() {
  const db = createServiceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tublyti.vercel.app';

  try {
    const data = await buildDigestData(db);
    const html = buildDigestHtml(data, appUrl);
    const result = await sendDigestEmail(html);

    if (!result.ok) {
      return { error: result.error ?? 'Echec de l\'envoi.' };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    return { error: message };
  }
}
