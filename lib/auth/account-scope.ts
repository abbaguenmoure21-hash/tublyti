import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionUser } from '@/lib/auth/session';
import { listScopeNiches } from '@/lib/scope';

/**
 * Account scope for server actions, same rules as the MCP tools (lib/mcp/server.ts):
 * the team (admin) sees the whole catalogue, a client only the niches of its verified
 * channels and the niches it follows.
 */

/** Shown when a client asks about a video or a niche outside its themes. */
export const OUT_OF_SCOPE_MESSAGE = 'Cette vidéo n’est pas dans tes thématiques. Ajoute sa thématique dans Réglages pour l’analyser.';

/** Never matches a real niche: an empty scope must read nothing, not everything. */
const NO_NICHE = '00000000-0000-0000-0000-000000000000';

/** null = no restriction (admin); otherwise the account's niche ids (possibly empty). */
export async function accountNicheIds(db: SupabaseClient, user: Pick<SessionUser, 'id' | 'role'>): Promise<string[] | null> {
  if (user.role === 'admin') return null;
  return (await listScopeNiches(db, user.id)).map((n) => n.id);
}

/**
 * Niche filter of « Quel mot attire le plus ? ». scope 'all' is the whole catalogue for the team only;
 * for a client it means « all my themes ».
 */
export function keywordNicheFilter(
  role: SessionUser['role'],
  scope: 'niche' | 'all',
  channelNicheId: string,
  accountIds: string[],
): string[] | null {
  if (scope !== 'all') return [channelNicheId];
  if (role === 'admin') return null;
  const ids = [...new Set([channelNicheId, ...accountIds].filter(Boolean))];
  return ids.length ? ids : [NO_NICHE];
}

/** A catalogue video whose channel belongs to a niche outside the scope is refused. Unknown video: allowed. */
export async function catalogueVideoInScope(db: SupabaseClient, videoId: string, nicheIds: string[] | null): Promise<boolean> {
  if (nicheIds === null) return true;
  const { data, error } = await db.from('videos').select('channels(niche_id)').eq('id', videoId).maybeSingle();
  if (error) return false; // fail closed
  const nicheId = (data?.channels as unknown as { niche_id: string | null } | null)?.niche_id ?? null;
  return !nicheId || nicheIds.includes(nicheId);
}

/** Off-catalogue video: the niche detected over the whole catalogue must be one of the account's. */
export async function nicheNameInScope(db: SupabaseClient, nicheName: string | null, nicheIds: string[] | null): Promise<boolean> {
  if (nicheIds === null) return true;
  if (!nicheName || !nicheIds.length) return false;
  const { data, error } = await db.from('niches').select('name').in('id', nicheIds);
  if (error) return false;
  return ((data ?? []) as { name: string }[]).some((n) => n.name === nicheName);
}
