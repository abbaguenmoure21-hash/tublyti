import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { listScopeNiches } from '@/lib/scope';
import { isAdminEmail, isMissingSchemaError } from '@/lib/auth/session';

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
      const match = (data?.users ?? []).filter(
        (u: { id: string; email?: string; email_confirmed_at?: string }) => Boolean(u.email_confirmed_at) && isAdminEmail(u.email),
      );
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
    // Best effort: without an owner the token is refused (fail closed).
  }
  return owner;
}

/** Le compte est-il administrateur (profil ou ADMIN_EMAILS) ? */
async function isAdminUser(db: Db, userId: string): Promise<boolean> {
  const { data: profile, error } = await db.from('profiles').select('role').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('profile lookup failed');
  if (profile?.role === 'admin') return true;
  if (!(process.env.ADMIN_EMAILS ?? '').trim()) return false;
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return Boolean(data?.user?.email_confirmed_at) && isAdminEmail(data?.user?.email);
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
  // Before migration 00019 (no user_id column) only. Any other error → refuse (fail closed).
  const preOwnerSchema = isMissingSchemaError(withOwner.error);
  if (withOwner.error && !preOwnerSchema) return null;
  if (preOwnerSchema) {
    const legacy = await db.from('api_tokens').select('id, name, permission').eq('token_hash', hash).is('revoked_at', null).maybeSingle();
    if (legacy.error) return null;
    row = (legacy.data as TokenRow | null) ?? null;
  } else {
    row = (withOwner.data as TokenRow | null) ?? null;
  }
  if (!row) return null;
  const token: TokenRow = row;

  // Mise à jour de la date d'utilisation (sans attendre)
  db.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', token.id).then(() => {});

  // Token created before 00019 (user_id empty): resolve and attach its owner.
  const legacy = !token.user_id && !preOwnerSchema;
  const userId = token.user_id ?? (legacy ? await resolveLegacyOwner(db, token.id) : null);

  // Deny by default: no rights until the owner is proven admin, no niche until listed.
  let isAdmin = false;
  let nicheIds: string[] | null = [];
  if (preOwnerSchema) {
    // Single-owner database (before 00019): the only tokens are the owner's.
    isAdmin = true;
    nicheIds = null;
  } else if (userId) {
    try {
      isAdmin = await isAdminUser(db, userId);
      nicheIds = isAdmin ? null : (await listScopeNiches(db, userId)).map((n) => n.id);
    } catch {
      return null;
    }
  } else {
    // Unresolvable owner: refuse rather than guess.
    return null;
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
