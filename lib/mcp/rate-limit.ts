import { createServiceClient } from '@/lib/supabase/server';

/** Daily limits per tool. Write tools have lower limits. */
const DAILY_LIMITS: Record<string, number> = {
  // Read tools — generous
  list_niches: 100,
  list_today: 50,
  list_opportunities: 100,
  search_topics: 50,
  get_topic_gap: 100,
  get_topic_phase: 100,
  list_frustrations: 100,
  get_niche_dossier: 30,
  channel_outliers: 50,
  similar_channels: 50,
  get_my_channel_stats: 40,
  get_video_retention: 60,
  // Write tools — tighter
  generate_angles: 10,
  save_to_collection: 50,
  create_pipeline_card: 30,
  mark_published: 20,
  add_candidate_channel: 20,
};

const DEFAULT_LIMIT = 50;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Check and increment usage for a token + tool combination.
 * Returns whether the call is allowed and how many calls remain.
 */
export async function checkRateLimit(
  tokenId: string,
  toolName: string,
): Promise<RateLimitResult> {
  const limit = DAILY_LIMITS[toolName] ?? DEFAULT_LIMIT;
  const db = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Get current count
  const { data: existing } = await db
    .from('api_usage')
    .select('call_count')
    .eq('token_id', tokenId)
    .eq('tool_name', toolName)
    .eq('usage_date', today)
    .single();

  const currentCount = existing?.call_count ?? 0;

  if (currentCount >= limit) {
    return { allowed: false, remaining: 0, limit };
  }

  // Increment (upsert)
  await db
    .from('api_usage')
    .upsert(
      {
        token_id: tokenId,
        tool_name: toolName,
        usage_date: today,
        call_count: currentCount + 1,
      },
      { onConflict: 'token_id,tool_name,usage_date' },
    );

  return { allowed: true, remaining: limit - currentCount - 1, limit };
}
