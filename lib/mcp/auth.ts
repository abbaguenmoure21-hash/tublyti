import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { listScopeNiches } from '@/lib/scope';

export interface McpTokenInfo {
  id: string;
  permission: 'read' | 'readwrite';
  name: string;
  /** Compte propriétaire du jeton (null pour un jeton créé avant la migration 00019). */
  userId: string | null;
  /** Jeton d'administrateur : accès à tout le catalogue et aux outils de gestion. */
  isAdmin: boolean;
  /** Thématiques autorisées. null = toutes (administrateur). */
  nicheIds: string[] | null;
}

/**
 * Authentifie une requête MCP ou extension avec la table api_tokens.
 * Renvoie les droits du jeton, ou null si le jeton est inconnu ou révoqué.
 */
export async function authenticateToken(rawToken: string): Promise<McpTokenInfo | null> {
  if (!rawToken || !rawToken.startsWith('tly_')) return null;

  const hash = createHash('sha256').update(rawToken).digest('hex');
  const db = createServiceClient();

  type TokenRow = { id: string; name: string; permission: string; user_id?: string | null };
  let row: TokenRow | null = null;
  const withOwner = await db.from('api_tokens').select('id, name, permission, user_id').eq('token_hash', hash).is('revoked_at', null).maybeSingle();
  if (withOwner.error) {
    // Avant la migration 00019 : pas de colonne user_id, jeton du propriétaire.
    const legacy = await db.from('api_tokens').select('id, name, permission').eq('token_hash', hash).is('revoked_at', null).maybeSingle();
    row = (legacy.data as TokenRow | null) ?? null;
  } else {
    row = (withOwner.data as TokenRow | null) ?? null;
  }
  if (!row) return null;
  const token: TokenRow = row;

  // Mise à jour de la date d'utilisation (sans attendre)
  db.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', token.id).then(() => {});

  const userId = token.user_id ?? null;
  let isAdmin = true;
  let nicheIds: string[] | null = null;
  if (userId) {
    const { data: profile } = await db.from('profiles').select('role').eq('user_id', userId).maybeSingle();
    isAdmin = profile?.role === 'admin';
    if (!isAdmin) nicheIds = (await listScopeNiches(db, userId)).map((n) => n.id);
  }

  return {
    id: token.id,
    permission: token.permission === 'readwrite' ? 'readwrite' : 'read',
    name: token.name,
    userId,
    isAdmin,
    nicheIds,
  };
}

/** Le jeton peut-il modifier des données ? */
export function canWrite(token: McpTokenInfo): boolean {
  return token.permission === 'readwrite';
}

/** Le jeton a-t-il accès à cette thématique ? */
export function canSeeNiche(token: McpTokenInfo, nicheId: string | null | undefined): boolean {
  if (token.nicheIds === null) return true;
  return Boolean(nicheId && token.nicheIds.includes(nicheId));
}
