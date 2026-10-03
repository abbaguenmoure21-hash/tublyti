import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlertSender } from '../email/alerts';

// ── Types ────────────────────────────────────────────────────────────

export type AlertRuleType =
  | 'phase_change'
  | 'collection_phase_change'
  | 'video_outlier'
  | 'window_closing';

interface AlertRule {
  id: string;
  workspace_id: string;
  /** Propriétaire de la règle (absent avant la migration 00019). */
  user_id?: string | null;
  rule_type: AlertRuleType;
  params: Record<string, unknown>;
  label: string;
  instant_email: boolean;
  enabled: boolean;
}

interface ScoredTopic {
  id: string;
  label: string;
  niche_id: string;
  phase: number;
  previousPhase: number | null;
  qualifiedIn72h: number;
}

export interface EvaluateResult {
  eventsCreated: number;
  instantEmailsSent: number;
}

// ── Evaluate all rules after scoring ─────────────────────────────────

export async function evaluateAlertRules(
  db: SupabaseClient,
  alertSender: AlertSender,
  scoredTopics: ScoredTopic[],
  videoOutliers: { videoId: string; title: string; views: number; channelTitle: string; subscriberCount: number; avgViews: number }[],
): Promise<EvaluateResult> {
  const result: EvaluateResult = { eventsCreated: 0, instantEmailsSent: 0 };

  // Load all enabled rules
  const { data: rules } = await db
    .from('alert_rules')
    .select('*')
    .eq('enabled', true);

  if (!rules || rules.length === 0) return result;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tublyti.vercel.app';
  const owners = new Map<string, Owner>();

  for (const rule of rules as AlertRule[]) {
    // Chaque client ne reçoit des alertes que sur ses thématiques et ses favoris.
    const owner = rule.user_id ? await loadOwner(db, rule.user_id, owners) : null;
    const topics = owner?.nicheIds ? scoredTopics.filter((t) => owner.nicheIds!.has(t.niche_id)) : scoredTopics;
    const outliers = owner && !owner.isAdmin ? [] : videoOutliers;
    const events = await evaluateRule(db, rule, topics, outliers);

    for (const event of events) {
      // Insert event
      await db.from('alert_events').insert({
        workspace_id: rule.workspace_id,
        rule_id: rule.id,
        rule_type: rule.rule_type,
        payload: event.payload,
        ...(rule.user_id ? { user_id: rule.user_id } : {}),
      });
      result.eventsCreated++;

      // Send instant email if configured
      if (rule.instant_email) {
        await alertSender.send({
          kind: 'burn_down', // reuse existing kind for email formatting
          subject: event.subject,
          body: event.body,
          actionUrl: event.actionUrl ? `${baseUrl}${event.actionUrl}` : undefined,
          actionLabel: event.actionLabel,
          to: owner?.email,
        });
        result.instantEmailsSent++;

        // Mark as emailed
        // (We just inserted it, get the latest for this rule)
        await db
          .from('alert_events')
          .update({ emailed: true })
          .eq('rule_id', rule.id)
          .eq('emailed', false)
          .order('created_at', { ascending: false })
          .limit(1);
      }
    }
  }

  return result;
}

// ── Propriétaire d'une règle ─────────────────────────────────────────

interface Owner {
  email: string | undefined;
  isAdmin: boolean;
  /** Thématiques du client ; null pour un administrateur (tout le catalogue). */
  nicheIds: Set<string> | null;
}

async function loadOwner(db: SupabaseClient, userId: string, cache: Map<string, Owner>): Promise<Owner> {
  const hit = cache.get(userId);
  if (hit) return hit;
  const [{ data: profile }, { data: auth }, { data: channels }, { data: followed }] = await Promise.all([
    db.from('profiles').select('role').eq('user_id', userId).maybeSingle(),
    db.auth.admin.getUserById(userId),
    db.from('user_channels').select('niche_id').eq('user_id', userId),
    db.from('user_niches').select('niche_id').eq('user_id', userId),
  ]);
  const isAdmin = profile?.role === 'admin';
  const owner: Owner = {
    email: auth?.user?.email ?? undefined,
    isAdmin,
    nicheIds: isAdmin
      ? null
      : new Set([...(channels ?? []), ...(followed ?? [])].map((r: { niche_id: string }) => r.niche_id)),
  };
  cache.set(userId, owner);
  return owner;
}

// ── Per-rule evaluation ──────────────────────────────────────────────

interface AlertEvent {
  payload: Record<string, unknown>;
  subject: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
}

async function evaluateRule(
  db: SupabaseClient,
  rule: AlertRule,
  scoredTopics: ScoredTopic[],
  videoOutliers: { videoId: string; title: string; views: number; channelTitle: string; subscriberCount: number; avgViews: number }[],
): Promise<AlertEvent[]> {
  switch (rule.rule_type) {
    case 'phase_change':
      return evaluatePhaseChange(rule, scoredTopics);
    case 'collection_phase_change':
      return evaluateCollectionPhaseChange(db, rule, scoredTopics);
    case 'video_outlier':
      return evaluateVideoOutlier(rule, videoOutliers);
    case 'window_closing':
      return evaluateWindowClosing(rule, scoredTopics);
    default:
      return [];
  }
}

function evaluatePhaseChange(rule: AlertRule, topics: ScoredTopic[]): AlertEvent[] {
  const targetPhase = (rule.params.target_phase as number) ?? 2;
  const nicheId = rule.params.niche_id as string | undefined;

  return topics
    .filter((t) => {
      if (nicheId && t.niche_id !== nicheId) return false;
      return t.phase === targetPhase && t.previousPhase !== null && t.previousPhase !== targetPhase;
    })
    .map((t) => ({
      payload: {
        topic_id: t.id,
        topic_label: t.label,
        previous_phase: t.previousPhase,
        new_phase: t.phase,
      },
      subject: `${t.label} passe en phase ${t.phase}`,
      body: `Le sujet « ${t.label} » vient de passer en phase ${t.phase} (depuis phase ${t.previousPhase}).`,
      actionUrl: `/topics/${t.id}`,
      actionLabel: 'Voir le sujet',
    }));
}

async function evaluateCollectionPhaseChange(
  db: SupabaseClient,
  rule: AlertRule,
  topics: ScoredTopic[],
): Promise<AlertEvent[]> {
  const collectionId = rule.params.collection_id as string | undefined;

  // Get topic IDs in the collection (or default favorites)
  let query = db
    .from('collection_items')
    .select('ref_id')
    .eq('item_type', 'topic');

  if (collectionId) {
    query = query.eq('collection_id', collectionId);
  } else if (rule.user_id) {
    // Sans collection précisée : tous les favoris du propriétaire de la règle.
    const { data: cols } = await db.from('collections').select('id').eq('user_id', rule.user_id);
    const ids = ((cols ?? []) as { id: string }[]).map((c) => c.id);
    query = query.in('collection_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  }

  const { data: items } = await query;
  if (!items || items.length === 0) return [];

  const collectionTopicIds = new Set(items.map((i: { ref_id: string }) => i.ref_id));

  return topics
    .filter((t) => {
      if (!collectionTopicIds.has(t.id)) return false;
      return t.previousPhase !== null && t.previousPhase !== t.phase;
    })
    .map((t) => ({
      payload: {
        topic_id: t.id,
        topic_label: t.label,
        previous_phase: t.previousPhase,
        new_phase: t.phase,
        collection_id: collectionId,
      },
      subject: `${t.label} change de phase (${t.previousPhase} → ${t.phase})`,
      body: `Le sujet favori « ${t.label} » est passe de phase ${t.previousPhase} a phase ${t.phase}.`,
      actionUrl: `/topics/${t.id}`,
      actionLabel: 'Voir le sujet',
    }));
}

function evaluateVideoOutlier(
  rule: AlertRule,
  outliers: { videoId: string; title: string; views: number; channelTitle: string; subscriberCount: number; avgViews: number }[],
): AlertEvent[] {
  const viewMultiplier = (rule.params.view_multiplier as number) ?? 5;
  const maxSubscribers = (rule.params.max_subscribers as number) ?? 50000;

  return outliers
    .filter((v) => {
      const ratio = v.avgViews > 0 ? v.views / v.avgViews : 0;
      return ratio >= viewMultiplier && v.subscriberCount <= maxSubscribers;
    })
    .map((v) => {
      const ratio = v.avgViews > 0 ? Math.round(v.views / v.avgViews) : 0;
      return {
        payload: {
          video_id: v.videoId,
          video_title: v.title,
          channel_title: v.channelTitle,
          views: v.views,
          avg_views: v.avgViews,
          subscriber_count: v.subscriberCount,
          ratio,
        },
        subject: `Video ${ratio}× sur ${v.channelTitle} (${formatSubs(v.subscriberCount)} abo.)`,
        body: `« ${v.title} » sur ${v.channelTitle} fait ${ratio}× la moyenne (${formatViews(v.views)} vues, chaine de ${formatSubs(v.subscriberCount)} abonnes).`,
        actionUrl: undefined,
        actionLabel: undefined,
      };
    });
}

function evaluateWindowClosing(rule: AlertRule, topics: ScoredTopic[]): AlertEvent[] {
  const minQualified = (rule.params.min_qualified_72h as number) ?? 5;

  return topics
    .filter((t) => t.qualifiedIn72h >= minQualified)
    .map((t) => ({
      payload: {
        topic_id: t.id,
        topic_label: t.label,
        qualified_in_72h: t.qualifiedIn72h,
      },
      subject: `Fenetre qui se ferme : ${t.label}`,
      body: `Le sujet « ${t.label} » a ${t.qualifiedIn72h} videos qualifiees publiees dans les 72 dernieres heures. La fenetre est en train de se fermer.`,
      actionUrl: `/topics/${t.id}`,
      actionLabel: 'Voir le sujet',
    }));
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatSubs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
