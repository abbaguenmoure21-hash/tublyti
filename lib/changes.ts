import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Historique des changements de titre et de miniature, avec leur effet :
 * rythme de vues (vues par jour) dans la semaine avant le changement, comparé au rythme depuis.
 * Une vidéo perd normalement du rythme en vieillissant : un rythme qui remonte après un changement
 * est donc un signal fort que le nouveau titre ou la nouvelle miniature marche mieux.
 */

export type ChangeKind = 'title_change' | 'thumbnail_change';

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
  daysAfter: number;
  gainSince: number | null;
}

type Snap = { t: number; views: number };

function pace(list: Snap[], at: number) {
  const before = list.filter((s) => s.t <= at + 3_600_000);
  const after = list.filter((s) => s.t > at + 3_600_000);
  const b1 = before[before.length - 1];
  if (!b1) return { before: null, after: null, effect: null, daysAfter: 0, last: list[list.length - 1] ?? null, b1: null as Snap | null };
  const b0 = [...before].reverse().find((s) => b1.t - s.t >= 1.5 * 86_400_000 && b1.t - s.t <= 16 * 86_400_000);
  const a = after[after.length - 1];
  const daysAfter = a ? (a.t - b1.t) / 86_400_000 : 0;
  const pb = b0 ? Math.max(0, b1.views - b0.views) / ((b1.t - b0.t) / 86_400_000) : null;
  const pa = a && daysAfter >= 1.5 ? Math.max(0, a.views - b1.views) / daysAfter : null;
  const effect = pb !== null && pa !== null && pb > 0 ? Math.round((pa / pb) * 100) / 100 : null;
  return { before: pb, after: pa, effect, daysAfter, last: a ?? null, b1 };
}

export async function getChanges(
  db: SupabaseClient,
  opts: { nicheIds: string[] | null; days?: number; kind?: ChangeKind | null; limit?: number },
): Promise<ChangeRow[]> {
  const since = new Date(Date.now() - (opts.days ?? 90) * 86_400_000).toISOString();
  let q = db
    .from('video_events')
    .select('id, video_id, event_type, old_value, new_value, meta, created_at, videos!inner(id, title, channels!inner(id, title, subscriber_count, niche_id))')
    .in('event_type', opts.kind ? [opts.kind] : ['title_change', 'thumbnail_change'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 300);
  if (opts.nicheIds) q = q.in('videos.channels.niche_id', opts.nicheIds.length ? opts.nicheIds : ['00000000-0000-0000-0000-000000000000']);
  const { data } = await q;
  const events = (data ?? []) as unknown as {
    id: string; video_id: string; event_type: ChangeKind; old_value: string | null; new_value: string | null; meta: Record<string, unknown> | null; created_at: string;
    videos: { id: string; title: string; channels: { id: string; title: string; subscriber_count: number | null; niche_id: string } };
  }[];

  // Relevés de vues des vidéos concernées (de 16 jours avant le plus ancien changement à aujourd'hui).
  const ids = [...new Set(events.map((e) => e.video_id))];
  const from = new Date(new Date(since).getTime() - 16 * 86_400_000).toISOString();
  const snaps = new Map<string, Snap[]>();
  for (let i = 0; i < ids.length; i += 100) {
    for (let off = 0; off < 50_000; off += 1000) {
      const { data: s } = await db
        .from('video_snapshots')
        .select('video_id, captured_at, views')
        .in('video_id', ids.slice(i, i + 100))
        .gte('captured_at', from)
        .order('captured_at', { ascending: true })
        .range(off, off + 999);
      const rows = (s ?? []) as { video_id: string; captured_at: string; views: number | null }[];
      for (const r of rows) snaps.set(r.video_id, [...(snaps.get(r.video_id) ?? []), { t: new Date(r.captured_at).getTime(), views: Number(r.views ?? 0) }]);
      if (rows.length < 1000) break;
    }
  }

  return events.map((e) => {
    const at = new Date(e.created_at).getTime();
    const p = pace(snaps.get(e.video_id) ?? [], at);
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
      daysAfter: Math.round(p.daysAfter * 10) / 10,
      gainSince: p.last && vac !== null ? Math.max(0, p.last.views - vac) : null,
    };
  });
}
