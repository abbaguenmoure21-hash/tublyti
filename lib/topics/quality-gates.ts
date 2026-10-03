import { SupabaseClient } from '@supabase/supabase-js';
import { isSensitiveTopic } from './sensitive';

const SINGLE_CHANNEL_THRESHOLD = 0.70;

export interface QualityGatesResult {
  rejectedMonoChannel: number;
  sensitiveFlagged: number;
}

/**
 * Run quality gates on active/proposed topics:
 *   1. Reject topics where > 70% of videos come from one channel
 *   2. Count sensitive topics (for reporting — filtering is at display time)
 */
export async function runQualityGates(
  db: SupabaseClient,
): Promise<QualityGatesResult> {
  const result: QualityGatesResult = { rejectedMonoChannel: 0, sensitiveFlagged: 0 };

  const { data: topics } = await db
    .from('topics')
    .select('id, label, status')
    .in('status', ['proposed', 'active', 'in_production']);

  if (!topics?.length) return result;

  const toReject: string[] = [];

  for (const t of topics) {
    if (isSensitiveTopic(t.label)) result.sensitiveFlagged++;

    const { data: videos } = await db
      .from('videos')
      .select('channel_id')
      .eq('topic_id', t.id);

    if (!videos || videos.length < 3) continue;

    const counts = new Map<string, number>();
    for (const v of videos) {
      counts.set(v.channel_id, (counts.get(v.channel_id) ?? 0) + 1);
    }

    const topCount = Math.max(...counts.values());
    if (topCount / videos.length > SINGLE_CHANNEL_THRESHOLD) {
      toReject.push(t.id);
    }
  }

  if (toReject.length > 0) {
    const { error } = await db
      .from('topics')
      .update({ status: 'rejected' })
      .in('id', toReject);

    if (!error) result.rejectedMonoChannel = toReject.length;
  }

  return result;
}
