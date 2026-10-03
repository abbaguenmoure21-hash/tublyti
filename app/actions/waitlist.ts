'use server';

import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';

const EmailSchema = z.string().trim().toLowerCase().email().max(254);

export type WaitlistState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

export async function joinWaitlist(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  // Champ piège invisible : un robot le remplit, un humain non.
  if (String(formData.get('company') ?? '').length > 0) {
    return { status: 'success', message: 'Merci, tu es sur la liste.' };
  }

  const parsed = EmailSchema.safeParse(formData.get('email'));
  if (!parsed.success) {
    return { status: 'error', message: 'Cette adresse e-mail ne semble pas valide.' };
  }

  const source = String(formData.get('source') ?? 'landing').slice(0, 40);
  const db = createServiceClient();
  const { error } = await db.from('waitlist').insert({ email: parsed.data, source });

  if (error) {
    // 23505 = déjà inscrit : on répond comme un succès.
    if (error.code === '23505') {
      return { status: 'success', message: 'Tu es déjà sur la liste. On te prévient dès que ton accès est prêt.' };
    }
    console.error('[waitlist] insert error:', error.message);
    return { status: 'error', message: "L'inscription n'a pas fonctionné. Réessaie dans un instant." };
  }

  return { status: 'success', message: 'Merci, tu es sur la liste. On te prévient dès que ton accès est prêt.' };
}
