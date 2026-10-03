/**
 * Reject stale topics: active/proposed topics with < 5 videos
 * and older than 21 days get status='rejected'.
 *
 * Protection: never close a topic that has at least one angle
 * with user_id IS NOT NULL (= a user has claimed it for production).
 */
import { SupabaseClient } from '@supabase/supabase-js';

const MAX_AGE_DAYS = 21;
const MIN_VIDEOS = 5;

export interface RejectStaleResult {
  rejected: number;
  protected: number;
  details: string[];
}

export async function rejectStaleTopics(
  db: SupabaseClient,
  dryRun = false,
): Promise<RejectStaleResult> {
  const result: RejectStaleResult = { rejected: 0, protected: 0, details: [] };

  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();

  // Get active/proposed topics older than 21 days
  const { data: topics } = await db
    .from('topics')
    .select('id, label, niche_id, created_at')
    .in('status', ['active', 'proposed'])
    .lt('created_at', cutoff);

  if (!topics?.length) return result;

  for (const topic of topics) {
    // Count attached videos
    const { count: videoCount } = await db
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topic.id);

    if ((videoCount ?? 0) >= MIN_VIDEOS) continue;

    // Check if any angle has user_id (= user has claimed it)
    const { count: userAngleCount } = await db
      .from('angles')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topic.id)
      .not('user_id', 'is', null);

    const ageDays = Math.floor(
      (Date.now() - new Date(topic.created_at).getTime()) / 86_400_000,
    );

    if ((userAngleCount ?? 0) > 0) {
      result.protected++;
      result.details.push(
        `PROTECTED: ${topic.label} (${videoCount ?? 0} videos, ${ageDays}d, user angle exists)`,
      );
      continue;
    }

    if (!dryRun) {
      await db
        .from('topics')
        .update({ status: 'rejected' })
        .eq('id', topic.id);
    }

    result.rejected++;
    result.details.push(
      `${dryRun ? 'WOULD REJECT' : 'REJECTED'}: ${topic.label} (${videoCount ?? 0} videos, ${ageDays}d old)`,
    );
  }

  return result;
}
