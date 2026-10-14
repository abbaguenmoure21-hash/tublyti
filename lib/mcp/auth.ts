import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { listScopeNiches } from '@/lib/scope';
import { isAdminEmail } from '@/lib/auth/session';

type Db = ReturnType<typeof createServiceClient>;

/**
 * Jeton ancien (créé avant 00019, user_id vide) : retrouve son propriétaire.
 * Ordre : profil admin, adresse ADMIN_EMAILS, puis le seul compte qui a une chaîne connectée.
 * Le jeton est ensuite rattaché une fois pour toutes (auto-réparation).
 */
async function resolveLegacyOwner(db: Db, tokenId: string): Promise<string | null> {
  let owner: string | null = null;
  try {
    const { data: admins } = await db.from('profiles').select('user_id').eq('role', 'admin').limit(2);
    if (admins && admins.length === 1) owner = admins[0].user_id as string;

    if (!owner && (process.env.ADMIN_EMAILS ?? '').trim()) {
      const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      const match = (data?.users ?? []).filter((u: { id: string; email?: string }) => isAdminEmail(u.email));
      if (match.length === 1) owner = match[0].id;
    }

    if (!owner) {
      const { data: chans } = await db.from('user_channels').select('user_id').not('verified_at', 'is', null).limit(50);
      const ids: string[] = Array.from(new Set(((chans ?? []) as { user_id: string | null }[]).map((c) => c.user_id).filter((v): v is string => Boolean(v))));
      if (ids.length === 1) owner = ids[0];
    }

    if (owner) {
      await db.from('api_tokens').update({ user_id: owner }).eq('id', tokenId).is('user_id', null);
    }
  } catch {
    // Best effort : sans propriétaire, le jeton garde ses droits d'avant.
  }
  return owner;
}

/** Le compte est-il administrateur (profil ou ADMIN_EMAILS) ? */
async function isAdminUser(db: Db, userId: string): Promise<boolean> {
  const { data: profile } = await db.from('profiles').select('role').eq('user_id', userId).maybeSingle();
  if (profile?.role === 'admin') return true;
  if (!(process.env.ADMIN_EMAILS ?? '').trim()) return false;
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return isAdminEmail(data?.user?.email);
  } catch {
    return false;
  }
}

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

  const legacy = !token.user_id && !withOwner.error;
  const userId = token.user_id ?? (legacy ? await resolveLegacyOwner(db, token.id) : null);
  let isAdmin = true;
  let nicheIds: string[] | null = null;
  // Un jeton ancien rattaché automatiquement garde ses droits d'administrateur.
  if (userId && !legacy) {
    isAdmin = await isAdminUser(db, userId);
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
