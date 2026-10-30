import { cache } from 'react';
import { createServiceClient } from '@/lib/supabase/server';

type ServiceClient = ReturnType<typeof createServiceClient>;

// Memoised per request and per client instance (React cache): a page that calls this several
// times with the same client (e.g. /sujets: list + detail panel) reads topic_scores once.
const readLatestScoreDate = cache(async (client: ServiceClient): Promise<string> => {
  const { data } = await client
    .from('topic_scores')
    .select('scored_at')
    .order('scored_at', { ascending: false })
    .limit(1)
    .single();

  return data?.scored_at ?? new Date().toISOString().slice(0, 10);
});

/**
 * Returns the most recent scored_at date from topic_scores.
 * Falls back to today's date if no scores exist.
 */
export async function getLatestScoreDate(db?: ServiceClient): Promise<string> {
  return readLatestScoreDate(db ?? createServiceClient());
}
