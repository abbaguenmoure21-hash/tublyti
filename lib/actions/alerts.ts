'use server';

import { createServiceClient } from '@/lib/supabase/server';
import type { AlertRuleType } from '@/lib/alerts/evaluate';

// ── Types ────────────────────────────────────────────────────────────

interface AlertRuleInput {
  rule_type: AlertRuleType;
  params: Record<string, unknown>;
  label: string;
  instant_email: boolean;
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function getAlertRules() {
  const db = createServiceClient();
  const { data, error } = await db
    .from('alert_rules')
    .select('*')
    .order('created_at', { ascending: false });

  return { data: data ?? [], error: error?.message };
}

export async function createAlertRule(input: AlertRuleInput) {
  const db = createServiceClient();
  const { data, error } = await db
    .from('alert_rules')
    .insert({
      rule_type: input.rule_type,
      params: input.params,
      label: input.label,
      instant_email: input.instant_email,
    })
    .select()
    .single();

  return { data, error: error?.message };
}

export async function toggleAlertRule(id: string, enabled: boolean) {
  const db = createServiceClient();
  const { error } = await db
    .from('alert_rules')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('id', id);

  return { error: error?.message };
}

export async function deleteAlertRule(id: string) {
  const db = createServiceClient();
  const { error } = await db
    .from('alert_rules')
    .delete()
    .eq('id', id);

  return { error: error?.message };
}

// ── Events ──────────────────────────────────────────────────────────

export async function getUnreadAlertCount(): Promise<number> {
  const db = createServiceClient();
  const { count } = await db
    .from('alert_events')
    .select('*', { count: 'exact', head: true })
    .eq('read', false);

  return count ?? 0;
}

export async function getAlertEvents(limit = 50) {
  const db = createServiceClient();
  const { data, error } = await db
    .from('alert_events')
    .select('*, alert_rules!inner(label, rule_type)')
    .order('created_at', { ascending: false })
    .limit(limit);

  return { data: data ?? [], error: error?.message };
}

export async function markAlertsRead(ids: string[]) {
  if (ids.length === 0) return;
  const db = createServiceClient();
  await db
    .from('alert_events')
    .update({ read: true })
    .in('id', ids);
}

export async function markAllAlertsRead() {
  const db = createServiceClient();
  await db
    .from('alert_events')
    .update({ read: true })
    .eq('read', false);
}

// ── Preview: count how many times a rule would have triggered ────────

export async function previewRuleTriggerCount(
  ruleType: AlertRuleType,
  params: Record<string, unknown>,
): Promise<number> {
  const db = createServiceClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  switch (ruleType) {
    case 'phase_change': {
      const targetPhase = (params.target_phase as number) ?? 2;
      const nicheId = params.niche_id as string | undefined;

      // Count topics that entered the target phase in last 30 days
      let query = db
        .from('topic_scores')
        .select('topic_id', { count: 'exact', head: true })
        .eq('phase', targetPhase)
        .gte('scored_at', thirtyDaysAgo);

      if (nicheId) {
        query = query.eq('topics.niche_id', nicheId);
      }

      const { count } = await query;
      return count ?? 0;
    }

    case 'collection_phase_change': {
      const collectionId = params.collection_id as string | undefined;

      // Get collection topic IDs
      let itemQuery = db
        .from('collection_items')
        .select('ref_id')
        .eq('item_type', 'topic');

      if (collectionId) {
        itemQuery = itemQuery.eq('collection_id', collectionId);
      }

      const { data: items } = await itemQuery;
      if (!items || items.length === 0) return 0;

      const topicIds = items.map((i: { ref_id: string }) => i.ref_id);

      // Count score changes for these topics in last 30 days
      // Approximate: count distinct topic_id entries with any phase value
      const { count } = await db
        .from('topic_scores')
        .select('topic_id', { count: 'exact', head: true })
        .in('topic_id', topicIds)
        .gte('scored_at', thirtyDaysAgo);

      return count ?? 0;
    }

    case 'video_outlier': {
      const viewMultiplier = (params.view_multiplier as number) ?? 5;
      const maxSubscribers = (params.max_subscribers as number) ?? 50000;

      const { data: outliers } = await db
        .from('video_outliers')
        .select('video_id, score, videos!inner(channel_id, channels!inner(subscriber_count))')
        .gte('score', viewMultiplier)
        .gte('computed_at', new Date(Date.now() - 30 * 86_400_000).toISOString());

      return (outliers ?? []).filter((o: Record<string, unknown>) => {
        const subs = Number((o.videos as unknown as { channels: { subscriber_count: number | null } }).channels.subscriber_count ?? 0);
        return subs <= maxSubscribers;
      }).length;
    }

    case 'window_closing': {
      // Count topics that had ≥ N qualified videos in 72h in recent scores
      // Approximation: count burn_down alerts in last 30 days
      const { count } = await db
        .from('alert_events')
        .select('*', { count: 'exact', head: true })
        .eq('rule_type', 'window_closing')
        .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString());

      return count ?? 0;
    }

    default:
      return 0;
  }
}
