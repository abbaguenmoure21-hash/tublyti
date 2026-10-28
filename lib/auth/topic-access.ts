import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { listScopeNiches } from '@/lib/scope';
import type { SessionUser } from '@/lib/auth/session';

const uuidSchema = z.string().uuid();

/**
 * Can this account see this topic? Admin: any existing topic. Client: only topics of the
 * niches it can access (verified channels + followed niches), like the topic page.
 * Fails closed: invalid id, unknown topic or any read error → false.
 */
export async function canSeeTopic(user: Pick<SessionUser, 'id' | 'role'>, topicId: string): Promise<boolean> {
  if (!uuidSchema.safeParse(topicId).success) return false;
  const db = createServiceClient();
  const { data: topic, error } = await db.from('topics').select('niche_id').eq('id', topicId).maybeSingle();
  if (error || !topic) return false;
  if (user.role === 'admin') return true;
  const nicheId = (topic as { niche_id: string | null }).niche_id;
  if (!nicheId) return false;
  const mine = await listScopeNiches(db, user.id);
  return mine.some((n) => n.id === nicheId);
}
