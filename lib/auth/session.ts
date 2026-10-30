import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export type Role = 'client' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  displayName: string;
}

/**
 * Is this Supabase/PostgREST error a "column/table does not exist" error
 * (i.e. the migration has not been applied yet)? Any other error (network, timeout,
 * 503, connection limit…) must NOT be treated as "old schema": callers fail closed.
 */
export function isMissingSchemaError(error: { code?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42703' || error.code === 'PGRST204' || error.code === '42P01' || error.code === 'PGRST205';
}

/**
 * La base a-t-elle reçu la migration 00018 (espace client) ?
 * Tant que non, l'app fonctionne comme avant : un seul propriétaire, chaînes lues dans les niches.
 * Fail closed: only a precise "missing column" error means "not migrated"; a transient
 * error keeps the multi-tenant behaviour (never grants admin rights).
 */
export const isDbReady = cache(async (): Promise<boolean> => {
  const { error } = await createServiceClient().from('angles').select('user_id').limit(1);
  return !isMissingSchemaError(error);
});

/** Adresses toujours administratrices (variable ADMIN_EMAILS, séparées par des virgules). */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** Utilisateur connecté + rôle (lu une seule fois par requête). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  const db = createServiceClient();
  const [{ data: profile }, ready] = await Promise.all([
    db.from('profiles').select('role, display_name').eq('user_id', user.id).maybeSingle(),
    isDbReady(),
  ]);
  // Avant la migration, le seul compte (ALLOW_SIGNUP=false) est le propriétaire.
  // ADMIN_EMAILS only counts once the address is confirmed (prevents signing up with an admin address).
  const confirmedAdminEmail = Boolean(user.email_confirmed_at) && isAdminEmail(user.email);
  const role: Role = profile?.role === 'admin' || confirmedAdminEmail || !ready ? 'admin' : 'client';
  const displayName =
    (profile?.display_name as string | null) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email?.split('@')[0] ??
    'Moi';
  return { id: user.id, email: user.email ?? '', role, displayName };
});

/** Pour les pages client : renvoie l'utilisateur ou redirige vers la connexion. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/** Pour la console d'administration : réservé au rôle admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/sujets');
  return user;
}

/** Variante pour les server actions : ne redirige pas, renvoie null si non autorisé. */
export async function getAdminOrNull(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  return user?.role === 'admin' ? user : null;
}

/** Pour les server actions de la console : lève une erreur si l'utilisateur n'est pas admin. */
export async function assertAdmin(): Promise<SessionUser> {
  const user = await getAdminOrNull();
  if (!user) throw new Error("Action réservée à l'administration.");
  return user;
}

/** La base a-t-elle reçu la migration 00019 (favoris, alertes et jetons par compte) ? */
export const hasPersonalTools = cache(async (): Promise<boolean> => {
  const { error } = await createServiceClient().from('api_tokens').select('user_id').limit(1);
  // Fail closed: a transient error keeps the per-account filter on.
  return !isMissingSchemaError(error);
});

/**
 * Accès aux outils personnels (favoris, alertes, jetons).
 * Après 00019 : tout compte connecté, chacun chez soi. Avant : l'administrateur seul (données encore communes).
 */
export async function getToolsUser(): Promise<(SessionUser & { personal: boolean }) | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const personal = await hasPersonalTools();
  if (!personal && user.role !== 'admin') return null;
  return { ...user, personal };
}
