'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { randomBytes, createHash } from 'crypto';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createApiToken(name: string, permission: 'read' | 'readwrite') {
  if (!name?.trim()) return { error: 'Le nom est requis.' };

  const rawToken = `tly_${randomBytes(24).toString('hex')}`;
  const tokenHash = hashToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 12);

  const db = createServiceClient();

  const { error } = await db
    .from('api_tokens')
    .insert({
      name: name.trim(),
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      permission,
    });

  if (error) return { error: error.message };

  revalidatePath('/settings');
  // Return the raw token only once — it won't be retrievable again
  return { token: rawToken };
}

export async function listApiTokens() {
  const db = createServiceClient();

  const { data, error } = await db
    .from('api_tokens')
    .select('id, name, token_prefix, permission, last_used_at, created_at, revoked_at')
    .order('created_at', { ascending: false });

  if (error) return { error: error.message, data: [] };
  return { data: data ?? [] };
}

export async function revokeApiToken(tokenId: string) {
  const db = createServiceClient();

  const { error } = await db
    .from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .is('revoked_at', null);

  if (error) return { error: error.message };

  revalidatePath('/settings');
  return { success: true };
}
