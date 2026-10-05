import { SupabaseClient } from '@supabase/supabase-js';
import { isSensitiveTopic } from './sensitive';
import { autoValidateTopics } from './auto-validate';

const SINGLE_CHANNEL_THRESHOLD = 0.70;
const CHANNEL_NAME_RE = /\bchannel\b/i;

export interface QualityGatesResult {
  rejectedMonoChannel: number;
  rejectedChannelName: number;
  sensitiveFlagged: number;
  /** Validation automatique des sujets proposés (après les contrôles). */
  autoPublished?: number;
  autoMerged?: number;
  autoWaiting?: number;
}

/**
 * Run quality gates on active/proposed topics:
 *   1. Reject topics where > 70% of videos come from one channel
 *   2. Count sensitive topics (for reporting — filtering is at display time)
 */
export async function runQualityGates(
  db: SupabaseClient,
): Promise<QualityGatesResult> {
  const result: QualityGatesResult = { rejectedMonoChannel: 0, rejectedChannelName: 0, sensitiveFlagged: 0 };
  const finish = async () => {
    // Les sujets proposés qui ont passé les contrôles sont publiés ou fusionnés automatiquement.
    try {
      const auto = await autoValidateTopics(db);
      result.autoPublished = auto.published;
      result.autoMerged = auto.merged;
      result.autoWaiting = auto.waiting;
      console.log(`  Validation automatique : ${auto.published} publiés, ${auto.merged} fusionnés, ${auto.waiting} en attente, ${auto.sensitive} sensibles (manuel)`);
    } catch (e) {
      console.error(`  auto-validate: ${(e as Error).message}`);
    }
    return result;
  };

  const { data: topics } = await db
    .from('topics')
    .select('id, label, status')
    .in('status', ['proposed', 'active', 'in_production']);

  if (!topics?.length) return finish();

  const toRejectMono: string[] = [];
  const toRejectName: string[] = [];

  for (const t of topics) {
    if (isSensitiveTopic(t.label)) result.sensitiveFlagged++;

    // Gate: channel-name topics (e.g. "sleepless historian channel")
    if (CHANNEL_NAME_RE.test(t.label)) {
      toRejectName.push(t.id);
      continue; // no need to check mono-channel
    }

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
      toRejectMono.push(t.id);
    }
  }

  const allRejectIds = [...new Set([...toRejectMono, ...toRejectName])];
  if (allRejectIds.length > 0) {
    const { error } = await db
      .from('topics')
      .update({ status: 'rejected' })
      .in('id', allRejectIds);

    if (!error) {
      result.rejectedMonoChannel = toRejectMono.length;
      result.rejectedChannelName = toRejectName.length;
    }
  }

  return finish();
}
