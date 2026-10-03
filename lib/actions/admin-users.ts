'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getAdminOrNull } from '@/lib/auth/session';

/** Console : changer le rôle d'un compte (client ↔ admin). Un admin ne peut pas se retirer ses propres droits. */
export async function setUserRole(userId: string, role: 'client' | 'admin') {
  const admin = await getAdminOrNull();
  if (!admin) return { error: "Action réservée à l'administration." };
  if (!z.string().uuid().safeParse(userId).success || !['client', 'admin'].includes(role)) return { error: 'Demande invalide.' };
  if (userId === admin.id && role !== 'admin') return { error: 'Tu ne peux pas retirer tes propres droits d’administration.' };
  const { error } = await createServiceClient().from('profiles').upsert({ user_id: userId, role });
  if (error) return { error: 'Le rôle n’a pas pu être changé.' };
  revalidatePath('/admin/utilisateurs');
  return { success: true };
}
