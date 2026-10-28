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
  list_my_channels: 100,
  list_my_videos: 100,
  get_video_performance: 200,
  analyze_video: 15,
  check_saturation: 60,
  compare_keywords: 60,
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
  /** true when the counter could not be read/written (call refused, fail closed). */
  error?: boolean;
}

export function dailyLimit(toolName: string): number {
  return DAILY_LIMITS[toolName] ?? DEFAULT_LIMIT;
}

const MAX_CAS_ATTEMPTS = 10;

/**
 * Check and increment usage for a token + tool combination, atomically.
 *
 * No SQL function needed: the row is created with ON CONFLICT DO NOTHING, then
 * incremented with a compare-and-swap (`update ... where call_count = <read value>`).
 * Two concurrent calls cannot both write the same value: the loser sees 0 updated
 * rows and retries with the fresh count. Fails closed on database errors.
 * (A single-statement RPC `increment_api_usage` is proposed in the audit notes.)
 */
export async function checkRateLimit(
  tokenId: string,
  toolName: string,
): Promise<RateLimitResult> {
  const limit = dailyLimit(toolName);
  const db = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const key = { token_id: tokenId, tool_name: toolName, usage_date: today };

  const { error: insErr } = await db
    .from('api_usage')
    .upsert({ ...key, call_count: 0 }, { onConflict: 'token_id,tool_name,usage_date', ignoreDuplicates: true });
  if (insErr) {
    console.error('[mcp:rate-limit] insert failed', insErr);
    return { allowed: false, remaining: 0, limit, error: true };
  }

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { data: row, error: selErr } = await db
      .from('api_usage')
      .select('call_count')
      .match(key)
      .maybeSingle();
    if (selErr) {
      console.error('[mcp:rate-limit] read failed', selErr);
      return { allowed: false, remaining: 0, limit, error: true };
    }
    const current = Number(row?.call_count ?? 0);
    if (current >= limit) return { allowed: false, remaining: 0, limit };

    const { data: updated, error: updErr } = await db
      .from('api_usage')
      .update({ call_count: current + 1 })
      .match(key)
      .eq('call_count', current)
      .select('call_count');
    if (updErr) {
      console.error('[mcp:rate-limit] update failed', updErr);
      return { allowed: false, remaining: 0, limit, error: true };
    }
    if (updated && updated.length === 1) {
      return { allowed: true, remaining: limit - current - 1, limit };
    }
    // Lost the race: another call incremented first. Retry with the fresh value.
  }
  return { allowed: false, remaining: 0, limit, error: true };
}
