'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes, createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { getToolsUser } from '@/lib/auth/session';

const NO_ACCESS = { error: 'Connecte-toi pour gérer tes accès.' };
const MAX_TOKENS = 5;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type ToolsUser = NonNullable<Awaited<ReturnType<typeof getToolsUser>>>;

function mine<Q>(q: Q, user: ToolsUser): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return user.personal ? (q as any).eq('user_id', user.id) : q;
}

/**
 * Crée un jeton d'accès (connexion à Claude, extension Chrome).
 * Un jeton client ne donne accès qu'aux thématiques de son compte.
 */
export async function createApiToken(name: string, permission: 'read' | 'readwrite'): Promise<{ error?: string; token?: string }> {
  const user = await getToolsUser();
  if (!user) return NO_ACCESS;
  const n = name?.trim();
  if (!n) return { error: 'Le nom est requis.' };
  if (!['read', 'readwrite'].includes(permission)) return { error: 'Permission invalide.' };

  const db = createServiceClient();
  const { count } = await mine(db.from('api_tokens').select('id', { count: 'exact', head: true }).is('revoked_at', null), user);
  if (user.role !== 'admin' && (count ?? 0) >= MAX_TOKENS) return { error: `Tu peux avoir jusqu’à ${MAX_TOKENS} jetons actifs.` };

  const rawToken = `tly_${randomBytes(24).toString('hex')}`;
  const { error } = await db.from('api_tokens').insert({
    name: n.slice(0, 60),
    token_hash: hashToken(rawToken),
    token_prefix: rawToken.slice(0, 12),
    permission,
    ...(user.personal ? { user_id: user.id } : {}),
  });
  if (error) return { error: 'Le jeton n’a pas pu être créé.' };

  revalidatePath('/settings');
  revalidatePath('/admin/reglages');
  // Le jeton complet n'est affiché qu'une seule fois.
  return { token: rawToken };
}

export async function listApiTokens() {
  const user = await getToolsUser();
  if (!user) return { data: [] };
  const db = createServiceClient();
  const { data, error } = await mine(
    db.from('api_tokens').select('id, name, token_prefix, permission, last_used_at, created_at, revoked_at'),
    user,
  ).order('created_at', { ascending: false });
  if (error) return { error: error.message, data: [] };
  return { data: data ?? [] };
}

export async function revokeApiToken(tokenId: string): Promise<{ error?: string; success?: boolean }> {
  const user = await getToolsUser();
  if (!user) return NO_ACCESS;
  const db = createServiceClient();
  const { error } = await mine(
    db.from('api_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', tokenId).is('revoked_at', null),
    user,
  );
  if (error) return { error: 'Le jeton n’a pas pu être révoqué.' };
  revalidatePath('/settings');
  revalidatePath('/admin/reglages');
  return { success: true };
}
