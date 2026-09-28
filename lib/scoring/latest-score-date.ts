import { createServiceClient } from '@/lib/supabase/server';

/**
 * Returns the most recent scored_at date from topic_scores.
 * Falls back to today's date if no scores exist.
 */
export async function getLatestScoreDate(db?: ReturnType<typeof createServiceClient>): Promise<string> {
  const client = db ?? createServiceClient();

  const { data } = await client
    .from('topic_scores')
    .select('scored_at')
    .order('scored_at', { ascending: false })
    .limit(1)
    .single();

  return data?.scored_at ?? new Date().toISOString().slice(0, 10);
}
