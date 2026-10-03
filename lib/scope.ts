import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Cookie qui mémorise la chaîne affichée partout dans l'app. */
export const SCOPE_COOKIE = 'tublyti-scope';

export interface ScopeNiche {
  /** Identifiant de la niche du catalogue (clé de filtrage des sujets). */
  id: string;
  /** Nom affiché : le nom de la chaîne du client, ou le nom de la niche si elle est suivie sans chaîne. */
  label: string;
  nicheName: string;
  /** « channel » = une chaîne du client ; « niche » = une niche suivie sans chaîne. */
  kind: 'channel' | 'niche';
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

/** Les chaînes du client, puis les niches qu'il suit sans chaîne. */
export async function listScopeNiches(db: SupabaseClient, userId: string): Promise<ScopeNiche[]> {
  const [channelsRes, nichesRes] = await Promise.all([
    db.from('user_channels').select('title, niche_id, niches(name, category)').eq('user_id', userId).order('title'),
    db.from('user_niches').select('niche_id, niches(name, category)').eq('user_id', userId),
  ]);
  if (channelsRes.error) return legacyScopeNiches(db);
  const channels = ((channelsRes.data ?? []) as unknown as {
    title: string; niche_id: string; niches: { name: string; category: string } | null;
  }[]).map((c) => ({
    id: c.niche_id,
    label: c.title,
    nicheName: c.niches?.name ?? '',
    kind: 'channel' as const,
    color: nicheColor(c.niches?.category),
  }));
  const taken = new Set(channels.map((c) => c.id));
  const followed = ((nichesRes.data ?? []) as unknown as {
    niche_id: string; niches: { name: string; category: string } | null;
  }[])
    .filter((n) => !taken.has(n.niche_id))
    .map((n) => ({
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
      id: n.id,
      label: n.owner_channel!.trim(),
      nicheName: n.name,
      kind: 'channel' as const,
      color: nicheColor(n.category),
    }));
}

/**
 * Chaîne affichée + niches à inclure dans les requêtes.
 * « Toutes mes chaînes » = les niches des chaînes du client et celles qu'il suit. Jamais le reste du catalogue.
 */
export async function resolveScope(
  db: SupabaseClient,
  userId: string,
): Promise<{ scope: string | null; nicheIds: string[]; niches: ScopeNiche[] }> {
  const [stored, niches] = await Promise.all([getScope(), listScopeNiches(db, userId)]);
  const scope = stored && niches.some((n) => n.id === stored) ? stored : null;
  const nicheIds = scope ? [scope] : niches.map((n) => n.id);
  return { scope, nicheIds, niches };
}
