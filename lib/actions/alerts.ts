'use server';

import { getToolsUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';

import { createServiceClient } from '@/lib/supabase/server';
import type { AlertRuleType } from '@/lib/alerts/evaluate';

// ── Types ────────────────────────────────────────────────────────────

interface AlertRuleInput {
  rule_type: AlertRuleType;
  params: Record<string, unknown>;
  label: string;
  instant_email: boolean;
}

// ── Accès ────────────────────────────────────────────────────────────

const NO_ACCESS = { error: 'Connecte-toi pour gérer tes alertes.' } as const;

type ToolsUser = NonNullable<Awaited<ReturnType<typeof getToolsUser>>>;

// Q is a supabase-js filter builder whose eq() returns `this`. A generic constraint
// on Q triggers TS2589 (builder types too deep), hence the narrow structural cast.
type EqFilterable<Q> = { eq(column: string, value: string): Q };
function mine<Q>(q: Q, user: ToolsUser): Q {
  return user.personal ? (q as unknown as EqFilterable<Q>).eq('user_id', user.id) : q;
}

/** Une règle client ne peut viser que ses thématiques et ses propres collections. */
async function validateParams(user: ToolsUser, input: AlertRuleInput): Promise<string | null> {
  if (user.role === 'admin') return null;
  if (input.rule_type === 'video_outlier') return 'Ce type d’alerte est réservé à l’équipe TubLyTI.';
  const db = createServiceClient();
  if (input.rule_type === 'phase_change' && input.params.niche_id) {
    const { nicheIds } = await resolveScope(db, user.id);
    if (!nicheIds.includes(String(input.params.niche_id))) return 'Choisis une de tes thématiques.';
  }
  if (input.rule_type === 'collection_phase_change' && input.params.collection_id) {
    const { data } = await db.from('collections').select('id').eq('id', String(input.params.collection_id)).eq('user_id', user.id).maybeSingle();
    if (!data) return 'Collection introuvable.';
  }
  return null;
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function getAlertRules() {
  const user = await getToolsUser();
  if (!user) return { data: [] };
  const db = createServiceClient();
  const { data, error } = await mine(db.from('alert_rules').select('*'), user).order('created_at', { ascending: false });
  return { data: data ?? [], error: error?.message };
}

export async function createAlertRule(input: AlertRuleInput) {
  const user = await getToolsUser();
  if (!user) return { data: null, error: NO_ACCESS.error };
  const invalid = await validateParams(user, input);
  if (invalid) return { data: null, error: invalid };
  const db = createServiceClient();
  const { count } = await mine(db.from('alert_rules').select('id', { count: 'exact', head: true }), user);
  if (user.role !== 'admin' && (count ?? 0) >= 20) return { data: null, error: 'Tu peux créer jusqu’à 20 alertes.' };
  const { data, error } = await db
    .from('alert_rules')
    .insert({
      rule_type: input.rule_type,
      params: input.params,
      label: input.label.slice(0, 120),
      instant_email: input.instant_email,
      ...(user.personal ? { user_id: user.id } : {}),
    })
    .select()
    .single();
  return { data, error: error?.message };
}

export async function toggleAlertRule(id: string, enabled: boolean) {
  const user = await getToolsUser();
  if (!user) return { error: NO_ACCESS.error };
  const db = createServiceClient();
  const { error } = await mine(db.from('alert_rules').update({ enabled, updated_at: new Date().toISOString() }).eq('id', id), user);
  return { error: error?.message };
}

export async function deleteAlertRule(id: string) {
  const user = await getToolsUser();
  if (!user) return { error: NO_ACCESS.error };
  const db = createServiceClient();
  const { error } = await mine(db.from('alert_rules').delete().eq('id', id), user);
  return { error: error?.message };
}

// ── Events ──────────────────────────────────────────────────────────

export async function getUnreadAlertCount(): Promise<number> {
  const user = await getToolsUser();
  if (!user) return 0;
  const db = createServiceClient();
  const { count } = await mine(db.from('alert_events').select('*', { count: 'exact', head: true }).eq('read', false), user);
  return count ?? 0;
}

export async function getAlertEvents(limit = 50) {
  const user = await getToolsUser();
  if (!user) return { data: [] };
  const db = createServiceClient();
  const { data, error } = await mine(db.from('alert_events').select('*, alert_rules!inner(label, rule_type)'), user)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { data: data ?? [], error: error?.message };
}

export async function markAlertsRead(ids: string[]) {
  const user = await getToolsUser();
  if (!user || ids.length === 0) return;
  const db = createServiceClient();
  await mine(db.from('alert_events').update({ read: true }).in('id', ids), user);
}

export async function markAllAlertsRead() {
  const user = await getToolsUser();
  if (!user) return;
  const db = createServiceClient();
  await mine(db.from('alert_events').update({ read: true }).eq('read', false), user);
}

// ── Preview: count how many times a rule would have triggered ────────

export async function previewRuleTriggerCount(
  ruleType: AlertRuleType,
  params: Record<string, unknown>,
): Promise<number> {
  const user = await getToolsUser();
  if (!user) return 0;
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
      // Uniquement les collections du compte.
      const { data: cols } = await mine(db.from('collections').select('id'), user);
      const myCols = ((cols ?? []) as { id: string }[]).map((c) => c.id);
      if (collectionId && !myCols.includes(collectionId)) return 0;
      const itemQuery = db
        .from('collection_items')
        .select('ref_id')
        .eq('item_type', 'topic')
        .in('collection_id', collectionId ? [collectionId] : myCols.length ? myCols : ['00000000-0000-0000-0000-000000000000']);

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
      const { count } = await mine(db.from('alert_events').select('*', { count: 'exact', head: true }), user)
        .eq('rule_type', 'window_closing')
        .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString());

      return count ?? 0;
    }

    default:
      return 0;
  }
}
