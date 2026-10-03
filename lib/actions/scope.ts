'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { SCOPE_COOKIE } from '@/lib/scope';

const ScopeSchema = z.union([z.literal('all'), z.string().uuid()]);

/** Change la chaîne affichée dans toute l'application. */
export async function setScope(value: string) {
  const parsed = ScopeSchema.safeParse(value);
  if (!parsed.success) return { error: 'Chaîne inconnue.' };
  const store = await cookies();
  store.set(SCOPE_COOKIE, parsed.data, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
  });
  revalidatePath('/', 'layout');
  return { success: true };
}
