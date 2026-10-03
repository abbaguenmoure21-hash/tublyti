'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { escapeLike } from '@/lib/utils';

export interface SearchHit {
  id: string;
  label: string;
  type: 'topic' | 'niche' | 'channel';
  extra?: string;
}

/**
 * Recherche ⌘K. Un client ne trouve que les sujets de ses thématiques ;
 * l'admin trouve aussi les niches et les chaînes du catalogue.
 */
export async function searchEverything(query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const user = await getSessionUser();
  if (!user) return [];
  const db = createServiceClient();
  const pattern = `%${escapeLike(q.slice(0, 80))}%`;
  const { nicheIds, niches } = await resolveScope(db, user.id);
  const isAdmin = user.role === 'admin';
  const labelByNiche = new Map(niches.map((n) => [n.id, n.label]));

  let topicsQ = db.from('topics').select('id, label, niche_id, niches(name)').in('status', ['active', 'in_production']).ilike('label', pattern).limit(8);
  if (!isAdmin) topicsQ = topicsQ.in('niche_id', nicheIds.length ? nicheIds : ['00000000-0000-0000-0000-000000000000']);

  const [topicsRes, nichesRes, channelsRes] = await Promise.all([
    topicsQ,
    isAdmin ? db.from('niches').select('id, name').ilike('name', pattern).limit(4) : Promise.resolve({ data: [] }),
    isAdmin ? db.from('channels').select('id, title, niches(name)').ilike('title', pattern).limit(4) : Promise.resolve({ data: [] }),
  ]);

  const hits: SearchHit[] = [];
  for (const t of (topicsRes.data ?? []) as unknown as { id: string; label: string; niche_id: string; niches: { name: string } | null }[]) {
    hits.push({ id: t.id, label: t.label, type: 'topic', extra: labelByNiche.get(t.niche_id) ?? t.niches?.name });
  }
  for (const n of (nichesRes.data ?? []) as { id: string; name: string }[]) hits.push({ id: n.id, label: n.name, type: 'niche' });
  for (const c of (channelsRes.data ?? []) as unknown as { id: string; title: string; niches: { name: string } | null }[]) {
    hits.push({ id: c.id, label: c.title, type: 'channel', extra: c.niches?.name });
  }
  return hits;
}
