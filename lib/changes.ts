import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Historique des changements de titre et de miniature, avec leur effet :
 * rythme de vues (vues par jour) dans la semaine avant le changement, comparé au rythme depuis.
 * Une vidéo perd normalement du rythme en vieillissant : un rythme qui remonte après un changement
 * est donc un signal fort que le nouveau titre ou la nouvelle miniature marche mieux.
 *
 * The nightly `aggregate` step deletes `video_snapshots` older than 30 days, so a change can only
 * be measured inside that window. `CHANGES_WINDOW_DAYS` caps every query to it.
 */

export type ChangeKind = 'title_change' | 'thumbnail_change';

/** Raw snapshots are kept 30 days by the nightly purge. */
export const CHANGES_WINDOW_DAYS = 30;
/** Below this many views/day before the change, the ratio is statistical noise. */
export const MIN_PACE_BEFORE = 50;
/** A video younger than this at change time is still in its launch curve: before/after is not comparable. */
export const MIN_AGE_AT_CHANGE_DAYS = 3;
/** Minimum days of data after the change before measuring. */
export const MIN_DAYS_AFTER = 1.5;

/**
 * Why a change has no measured effect:
 * - too_recent: not enough days since the change yet (will be measured soon)
 * - no_before: no usable snapshot before the change (never measurable)
 * - no_after: change is old enough but no snapshot came after it (never measurable)
 * - too_young: video was too young when it changed (launch curve)
 * - low_volume: too few views/day before the change to read a ratio
 */
export type PaceReason = 'too_recent' | 'no_before' | 'no_after' | 'too_young' | 'low_volume';

export interface ChangeRow {
  id: string;
  videoId: string;
  kind: ChangeKind;
  oldValue: string | null;
  newValue: string | null;
  at: string;
  title: string;
  channel: string;
  channelId: string;
  subscribers: number;
  nicheId: string;
  viewsAtChange: number | null;
  /** Vues par jour avant / après. */
  paceBefore: number | null;
  paceAfter: number | null;
  /** Rythme après ÷ rythme avant (null tant que ce n'est pas mesurable). */
  effect: number | null;
  /** Set when `effect` is null. */
  reason: PaceReason | null;
  daysAfter: number;
  gainSince: number | null;
  /** Video age (days) when the change happened, if the publish date is known. */
  ageAtChangeDays: number | null;
}

export type Snap = { t: number; views: number };

const DAY = 86_400_000;

export interface PaceResult {
  before: number | null;
  after: number | null;
  effect: number | null;
  reason: PaceReason | null;
  daysAfter: number;
  last: Snap | null;
  b1: Snap | null;
}

/**
 * Pace before/after a change. `list` must be sorted by time ascending.
 * `now` is used to tell "too recent" (wait) from "no data before" (never).
 */
export function pace(list: Snap[], at: number, opts: { publishedAt?: number | null; now?: number } = {}): PaceResult {
  const now = opts.now ?? Date.now();
  const before = list.filter((s) => s.t <= at + 3_600_000);
  const after = list.filter((s) => s.t > at + 3_600_000);
  const b1 = before[before.length - 1] ?? null;
  const a = after[after.length - 1] ?? null;
  const last = b1 ? a : (list[list.length - 1] ?? null);
  const b0 = b1 ? [...before].reverse().find((s) => b1.t - s.t >= 1.5 * DAY && b1.t - s.t <= 16 * DAY) : undefined;

  const daysAfter = a && b1 ? (a.t - b1.t) / DAY : 0;
  const pb = b1 && b0 ? Math.max(0, b1.views - b0.views) / ((b1.t - b0.t) / DAY) : null;
  const pa = a && b1 && daysAfter >= MIN_DAYS_AFTER ? Math.max(0, a.views - b1.views) / daysAfter : null;

  let reason: PaceReason | null = null;
  if (pb === null) reason = 'no_before';
  else if (opts.publishedAt != null && (at - opts.publishedAt) / DAY < MIN_AGE_AT_CHANGE_DAYS) reason = 'too_young';
  else if (pb < MIN_PACE_BEFORE) reason = 'low_volume';
  else if (pa === null) reason = (now - at) / DAY < MIN_DAYS_AFTER + 1 ? 'too_recent' : 'no_after';

  const effect = reason === null && pb !== null && pa !== null && pb > 0 ? Math.round((pa / pb) * 100) / 100 : null;
  if (effect === null && reason === null) reason = 'low_volume';
  return { before: pb, after: pa, effect, reason, daysAfter, last, b1 };
}

/** Shared verdict, so /activity and /activity/changes read the same event the same way. */
export type VerdictTone = 'up' | 'flat' | 'down' | 'none';
export function changeVerdict(c: Pick<ChangeRow, 'effect' | 'reason'>): { label: string; tone: VerdictTone } {
  const times = (m: number) => `×${m.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;
  if (c.effect === null) {
    switch (c.reason) {
      case 'too_recent':
        return { label: 'Trop récent', tone: 'none' };
      case 'too_young':
        return { label: 'Vidéo trop jeune', tone: 'none' };
      case 'low_volume':
        return { label: 'Trop peu de vues', tone: 'none' };
      default:
        return { label: 'Pas mesurable', tone: 'none' };
    }
  }
  if (c.effect >= 1.3) return { label: `Relancée ${times(c.effect)}`, tone: 'up' };
  if (c.effect >= 0.8) return { label: 'Sans effet net', tone: 'flat' };
  return { label: `Rythme en baisse ${times(c.effect)}`, tone: 'down' };
}

/** Sort for "Ce qui a le mieux marché": measured first, by ratio, then by absolute pace gain. */
export function byBestEffect(a: ChangeRow, b: ChangeRow): number {
  const ea = a.effect ?? -1;
  const eb = b.effect ?? -1;
  if (eb !== ea) return eb - ea;
  return ((b.paceAfter ?? 0) - (b.paceBefore ?? 0)) - ((a.paceAfter ?? 0) - (a.paceBefore ?? 0));
}

const NO_NICHE = '00000000-0000-0000-0000-000000000000';

export async function getChanges(
  db: SupabaseClient,
  opts: { nicheIds: string[] | null; days?: number; kind?: ChangeKind | null; limit?: number; eventIds?: string[] },
): Promise<ChangeRow[]> {
  const now = Date.now();
  const days = Math.min(opts.days ?? CHANGES_WINDOW_DAYS, CHANGES_WINDOW_DAYS);
  const since = new Date(now - days * DAY).toISOString();
  let q = db
    .from('video_events')
    .select('id, video_id, event_type, old_value, new_value, meta, created_at, videos!inner(id, title, published_at, channels!inner(id, title, subscriber_count, niche_id))')
    .in('event_type', opts.kind ? [opts.kind] : ['title_change', 'thumbnail_change'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 300);
  if (opts.nicheIds) q = q.in('videos.channels.niche_id', opts.nicheIds.length ? opts.nicheIds : [NO_NICHE]);
  if (opts.eventIds) q = q.in('id', opts.eventIds.length ? opts.eventIds : [NO_NICHE]);
  const { data, error } = await q;
  if (error) throw new Error(`getChanges: video_events: ${error.message}`);
  const events = (data ?? []) as unknown as {
    id: string; video_id: string; event_type: ChangeKind; old_value: string | null; new_value: string | null; meta: Record<string, unknown> | null; created_at: string;
    videos: { id: string; title: string; published_at: string | null; channels: { id: string; title: string; subscriber_count: number | null; niche_id: string } };
  }[];

  // Snapshots of the affected videos. Older than 30 days they no longer exist (nightly purge),
  // so never ask for more than that.
  const ids = [...new Set(events.map((e) => e.video_id))];
  const from = new Date(Math.max(new Date(since).getTime() - 16 * DAY, now - (CHANGES_WINDOW_DAYS + 1) * DAY)).toISOString();
  const snaps = new Map<string, Snap[]>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  await Promise.all(
    chunks.map(async (chunk) => {
      for (let off = 0; off < 50_000; off += 1000) {
        const { data: s, error: sErr } = await db
          .from('video_snapshots')
          .select('video_id, captured_at, views')
          .in('video_id', chunk)
          .gte('captured_at', from)
          // Total order: many videos share the same nightly captured_at, so paginate on (captured_at, video_id).
          .order('captured_at', { ascending: true })
          .order('video_id', { ascending: true })
          .range(off, off + 999);
        if (sErr) throw new Error(`getChanges: video_snapshots: ${sErr.message}`);
        const rows = (s ?? []) as { video_id: string; captured_at: string; views: number | null }[];
        for (const r of rows) {
          let list = snaps.get(r.video_id);
          if (!list) snaps.set(r.video_id, (list = []));
          list.push({ t: new Date(r.captured_at).getTime(), views: Number(r.views ?? 0) });
        }
        if (rows.length < 1000) break;
      }
    }),
  );

  return events.map((e) => {
    const at = new Date(e.created_at).getTime();
    const publishedAt = e.videos.published_at ? new Date(e.videos.published_at).getTime() : null;
    const p = pace(snaps.get(e.video_id) ?? [], at, { publishedAt, now });
    const vac = typeof e.meta?.views_at_change === 'number' ? (e.meta.views_at_change as number) : p.b1?.views ?? null;
    return {
      id: e.id,
      videoId: e.video_id,
      kind: e.event_type,
      oldValue: e.old_value,
      newValue: e.new_value,
      at: e.created_at,
      title: e.videos.title,
      channel: e.videos.channels.title,
      channelId: e.videos.channels.id,
      subscribers: e.videos.channels.subscriber_count ?? 0,
      nicheId: e.videos.channels.niche_id,
      viewsAtChange: vac,
      paceBefore: p.before === null ? null : Math.round(p.before),
      paceAfter: p.after === null ? null : Math.round(p.after),
      effect: p.effect,
      reason: p.reason,
      daysAfter: Math.round(p.daysAfter * 10) / 10,
      gainSince: p.last && vac !== null ? Math.max(0, p.last.views - vac) : null,
      ageAtChangeDays: publishedAt !== null ? Math.max(0, Math.floor((at - publishedAt) / DAY)) : null,
    };
  });
}
