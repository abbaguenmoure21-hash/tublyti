import { cache } from 'react';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Cookie qui mémorise la chaîne affichée partout dans l'app. */
export const SCOPE_COOKIE = 'tublyti-scope';

export interface ScopeNiche {
  /** Clé unique dans le sélecteur « Afficher » : la chaîne du client, ou la niche suivie sans chaîne. */
  key: string;
  /** Identifiant de la niche du catalogue (clé de filtrage des sujets). Deux chaînes peuvent partager la même niche. */
  id: string;
  /** Nom affiché : le nom de la chaîne du client, ou le nom de la niche si elle est suivie sans chaîne. */
  label: string;
  nicheName: string;
  /** « channel » = une chaîne du client ; « niche » = une niche suivie sans chaîne. */
  kind: 'channel' | 'niche';
  /** Propriété de la chaîne prouvée (toujours vrai pour une niche suivie). */
  verified: boolean;
  /** Ligne user_channels de la chaîne (null pour une niche suivie). */
  channelId: string | null;
  /** Couleur de repère (catégorielle, distincte des couleurs de moment). */
  color: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  finance: '#0891b2',
  psychology: '#8459c3',
  ai: '#ea580c',
  ai_tools: '#ea580c',
  business: '#64748b',
  history: '#a16207',
  health: '#0f766e',
};

export function nicheColor(category: string | null | undefined): string {
  return CATEGORY_COLORS[category ?? ''] ?? '#5e636e';
}

export async function getScope(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(SCOPE_COOKIE)?.value;
  return value && value !== 'all' ? value : null;
}

/**
 * Les chaînes du client, puis les niches qu'il suit sans chaîne.
 * Par défaut, seules les chaînes vérifiées : une chaîne non vérifiée ne donne accès à aucune donnée.
 */
export async function listScopeNiches(
  db: SupabaseClient,
  userId: string,
  opts: { includePending?: boolean } = {},
): Promise<ScopeNiche[]> {
  const [firstChannelsRes, nichesRes] = await Promise.all([
    // Seules les chaînes dont la propriété est vérifiée comptent.
    db.from('user_channels').select('id, title, niche_id, verified_at, niches(name, category)').eq('user_id', userId).order('title'),
    db.from('user_niches').select('niche_id, niches(name, category)').eq('user_id', userId),
  ]);
  let channelsRes = firstChannelsRes;
  if (channelsRes.error) {
    // Avant la migration 00021 (pas de colonne verified_at) : toutes les chaînes comptent.
    channelsRes = (await db
      .from('user_channels')
      .select('id, title, niche_id, niches(name, category)')
      .eq('user_id', userId)
      .order('title')) as unknown as typeof channelsRes;
  }
  if (channelsRes.error) return legacyScopeNiches(db);
  const channels = ((channelsRes.data ?? []) as unknown as {
    id: string; title: string; niche_id: string; verified_at?: string | null; niches: { name: string; category: string } | null;
  }[])
    .filter((c) => opts.includePending || c.verified_at !== null) // undefined = colonne absente (avant 00021)
    .map((c) => ({
    verified: c.verified_at !== null,
    channelId: c.id,
    key: c.id,
    id: c.niche_id,
    label: c.title,
    nicheName: c.niches?.name ?? '',
    kind: 'channel' as const,
    color: nicheColor(c.niches?.category),
  }));
  const taken = new Set(channels.filter((c) => c.verified).map((c) => c.id));
  const followed = ((nichesRes.data ?? []) as unknown as {
    niche_id: string; niches: { name: string; category: string } | null;
  }[])
    .filter((n) => !taken.has(n.niche_id))
    .map((n) => ({
      verified: true,
      channelId: null,
      key: n.niche_id,
      id: n.niche_id,
      label: n.niches?.name ?? '',
      nicheName: n.niches?.name ?? '',
      kind: 'niche' as const,
      color: nicheColor(n.niches?.category),
    }));
  return [...channels, ...followed];
}

/** Avant la migration 00018 : les chaînes sont celles indiquées dans le catalogue des niches. */
async function legacyScopeNiches(db: SupabaseClient): Promise<ScopeNiche[]> {
  const { data } = await db
    .from('niches')
    .select('id, name, category, owner_channel')
    .eq('status', 'active')
    .not('owner_channel', 'is', null)
    .order('owner_channel');
  return ((data ?? []) as { id: string; name: string; category: string | null; owner_channel: string | null }[])
    .filter((n) => n.owner_channel?.trim())
    .map((n) => ({
      verified: true,
      channelId: null,
      key: n.id,
      id: n.id,
      label: n.owner_channel!.trim(),
      nicheName: n.name,
      kind: 'channel' as const,
      color: nicheColor(n.category),
    }));
}

/**
 * Per-request memo of the user's channels/niches (React `cache`): the app layout and the page both
 * call resolveScope during the same render, this keeps it to one round of `user_channels` /
 * `user_niches` reads. Keyed by userId only (the db client is not a stable cache key); the first
 * caller's client is used. Outside a React server render (route handlers), `cache` does not memoize.
 * The scope cookie itself is still read fresh on every call (getScope).
 */
const scopeChannelsMemo = cache((_userId: string): { promise: Promise<ScopeNiche[]> | null } => ({ promise: null }));

function scopeChannelsOnce(db: SupabaseClient, userId: string): Promise<ScopeNiche[]> {
  const box = scopeChannelsMemo(userId);
  if (!box.promise) {
    box.promise = listScopeNiches(db, userId, { includePending: true }).catch((err: unknown) => {
      box.promise = null; // do not memoize a failure
      throw err;
    });
  }
  return box.promise;
}

/**
 * Chaîne affichée + niches à inclure dans les requêtes.
 * « Toutes mes chaînes » = les niches des chaînes du client et celles qu'il suit. Jamais le reste du catalogue.
 */
export async function resolveScope(
  db: SupabaseClient,
  userId: string,
): Promise<{
  /** Niche de la chaîne affichée (null = toutes mes chaînes). */
  scope: string | null;
  /** Clé de l'élément choisi dans « Afficher » (chaîne ou niche suivie). */
  scopeKey: string | null;
  /** Nom de la chaîne affichée. */
  scopeLabel: string | null;
  /** Ligne user_channels de la chaîne affichée (null pour « toutes » ou une niche suivie). */
  scopeChannelId: string | null;
  /** Chaîne choisie mais pas encore vérifiée : aucune donnée n'est servie, l'app demande la vérification. */
  pendingChannel: ScopeNiche | null;
  /** Niches autorisées pour les requêtes (vide si la chaîne choisie n'est pas vérifiée). */
  nicheIds: string[];
  /** Chaînes vérifiées et niches suivies (données). */
  niches: ScopeNiche[];
  /** Tout ce que montre le sélecteur « Afficher », chaînes à vérifier comprises. */
  allChannels: ScopeNiche[];
}> {
  const [stored, allChannels] = await Promise.all([getScope(), scopeChannelsOnce(db, userId)]);
  const niches = allChannels.filter((n) => n.verified);
  // L'ancien cookie contenait un identifiant de niche : on l'accepte encore.
  const chosen = stored ? allChannels.find((n) => n.key === stored) ?? niches.find((n) => n.id === stored) ?? null : null;

  if (chosen && !chosen.verified) {
    return {
      scope: chosen.id,
      scopeKey: chosen.key,
      scopeLabel: chosen.label,
      scopeChannelId: chosen.channelId,
      pendingChannel: chosen,
      nicheIds: [],
      niches,
      allChannels,
    };
  }
  const scope = chosen?.id ?? null;
  const nicheIds = scope ? [scope] : [...new Set(niches.map((n) => n.id))];
  return {
    scope,
    scopeKey: chosen?.key ?? null,
    scopeLabel: chosen?.label ?? null,
    scopeChannelId: chosen?.channelId ?? null,
    pendingChannel: null,
    nicheIds,
    niches,
    allChannels,
  };
}

/** Nom affiché par niche : les noms des chaînes du client qui la partagent, séparés par « · ». */
export function labelsByNiche(niches: ScopeNiche[]): Map<string, string> {
  const map = new Map<string, string[]>();
  for (const n of niches) map.set(n.id, [...(map.get(n.id) ?? []), n.label]);
  return new Map([...map].map(([id, labels]) => [id, labels.join(' · ')]));
}
