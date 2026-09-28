import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import {
  Upload,
  Type,
  Image,
  TrendingUp,
  ArrowRight,
  Activity as ActivityIcon,
} from 'lucide-react';
import { ActivityFilters } from './_components/activity-filters';

export const metadata = { title: 'Activité' };

interface EventRow {
  id: string;
  videoId: string;
  eventType: string;
  oldValue: string | null;
  newValue: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  videoTitle: string;
  channelTitle: string;
  channelId: string;
  nicheName: string;
  nicheId: string;
  subscriberCount: number;
  // Snapshot data for view evolution after change
  viewsBefore: number | null;
  viewsAfter: number | null;
}

function parseChannelSize(chsize: string | null): { min: number; max: number } | null {
  if (!chsize) return null;
  const parts = chsize.split('-');
  return {
    min: parseInt(parts[0], 10) || 0,
    max: parts[1] ? parseInt(parts[1], 10) || Infinity : Infinity,
  };
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')} k`;
  return String(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);

  if (diffH < 1) return 'Il y a quelques minutes';
  if (diffH < 24) return `Il y a ${diffH} h`;

  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 1) return 'Hier';
  if (diffDays < 7) return `Il y a ${diffDays} jours`;

  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

const EVENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  new_upload: Upload,
  title_change: Type,
  thumbnail_change: Image,
  spike: TrendingUp,
};

const EVENT_LABELS: Record<string, string> = {
  new_upload: 'Nouvel upload',
  title_change: 'Titre modifié',
  thumbnail_change: 'Miniature modifiée',
  spike: 'Pic de vues',
};

const EVENT_COLORS: Record<string, string> = {
  new_upload: 'text-phase-0 bg-phase-0/10',
  title_change: 'text-primary bg-primary/10',
  thumbnail_change: 'text-phase-2 bg-phase-2/10',
  spike: 'text-destructive bg-destructive/10',
};

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; niche?: string; chsize?: string }>;
}) {
  const params = await searchParams;
  const typeFilter = params.type || null;
  const nicheFilter = params.niche || null;
  const channelSizeFilter = params.chsize || null;

  const db = createServiceClient();

  // Fetch niches for filter tabs
  const { data: niches } = await db
    .from('niches')
    .select('id, name')
    .eq('status', 'active')
    .order('name');

  // Fetch events (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let query = db
    .from('video_events')
    .select(
      `id, video_id, event_type, old_value, new_value, meta, created_at,
       videos!inner(id, title, channel_id, channels!inner(id, title, subscriber_count, niche_id, niches!inner(id, name)))`,
    )
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(100);

  if (typeFilter) {
    query = query.eq('event_type', typeFilter);
  }
  if (nicheFilter) {
    query = query.eq('videos.channels.niche_id', nicheFilter);
  }

  const { data: rawEvents } = await query;

  // Map to typed rows
  let events: EventRow[] = (rawEvents ?? []).map((e: Record<string, unknown>) => {
    const video = e.videos as unknown as {
      id: string;
      title: string;
      channel_id: string;
      channels: {
        id: string;
        title: string;
        subscriber_count: number | null;
        niche_id: string;
        niches: { id: string; name: string };
      };
    };
    return {
      id: e.id as string,
      videoId: e.video_id as string,
      eventType: e.event_type as string,
      oldValue: e.old_value as string | null,
      newValue: e.new_value as string | null,
      meta: e.meta as Record<string, unknown> | null,
      createdAt: e.created_at as string,
      videoTitle: video.title,
      channelTitle: video.channels.title,
      channelId: video.channels.id,
      nicheName: video.channels.niches.name,
      nicheId: video.channels.niches.id,
      subscriberCount: video.channels.subscriber_count ?? 0,
      viewsBefore: null,
      viewsAfter: null,
    };
  });

  // Channel size filter (client-side since it's on a joined field)
  const sizeRange = parseChannelSize(channelSizeFilter);
  if (sizeRange) {
    events = events.filter(
      (e) => e.subscriberCount >= sizeRange.min && e.subscriberCount < sizeRange.max,
    );
  }

  // For title/thumbnail changes, fetch view evolution (snapshot before and after the event)
  const changeEvents = events.filter(
    (e) => e.eventType === 'title_change' || e.eventType === 'thumbnail_change',
  );
  if (changeEvents.length > 0) {
    for (const evt of changeEvents) {
      const { data: snaps } = await db
        .from('video_snapshots')
        .select('captured_at, views')
        .eq('video_id', evt.videoId)
        .order('captured_at', { ascending: false })
        .limit(5);

      if (snaps && snaps.length >= 2) {
        const evtDate = new Date(evt.createdAt).getTime();
        const before = snaps.find(
          (s: Record<string, unknown>) => new Date(s.captured_at as string).getTime() <= evtDate,
        );
        const after = snaps.find(
          (s: Record<string, unknown>) => new Date(s.captured_at as string).getTime() > evtDate,
        );
        if (before) evt.viewsBefore = Number(before.views);
        if (after) evt.viewsAfter = Number(after.views);
      }
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="h-[60px] shrink-0 flex items-center gap-3 px-8 border-b border-border bg-card text-[14px] text-muted-foreground">
        <span>Activité</span>
      </header>

      <div className="flex-1 p-7 flex flex-col gap-5">
        <div className="space-y-1.5">
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] leading-tight">
            Fil d&apos;activité
          </h1>
          <p className="text-[15px] text-muted-foreground">
            Changements détectés sur les vidéos suivies : uploads, modifications de titre ou miniature, pics de vues.
          </p>
        </div>

        <ActivityFilters niches={niches ?? []} />

        {events.length > 0 ? (
          <div className="space-y-3">
            {events.map((evt) => {
              const Icon = EVENT_ICONS[evt.eventType] ?? Upload;
              const colorClass = EVENT_COLORS[evt.eventType] ?? 'text-muted-foreground bg-muted';

              return (
                <div
                  key={evt.id}
                  className="bg-card border border-border rounded-[10px] p-4 shadow-[0_1px_2px_rgba(20,24,34,0.06)]"
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-medium">
                          {EVENT_LABELS[evt.eventType] ?? evt.eventType}
                        </span>
                        <span className="text-[13px] text-muted-foreground">·</span>
                        <span className="text-[13px] text-muted-foreground">
                          {evt.channelTitle}
                        </span>
                        <span className="text-[13px] text-muted-foreground">·</span>
                        <span className="text-[12px] text-muted-foreground/70">
                          {formatDate(evt.createdAt)}
                        </span>
                      </div>

                      <Link
                        href={`https://youtube.com/watch?v=${evt.videoId}`}
                        target="_blank"
                        className="text-[15px] font-semibold text-foreground hover:text-primary transition-colors block truncate"
                      >
                        {evt.videoTitle}
                      </Link>

                      {/* Before/After for title changes */}
                      {evt.eventType === 'title_change' && evt.oldValue && evt.newValue && (
                        <div className="flex flex-col sm:flex-row gap-2 mt-2">
                          <div className="flex-1 rounded-lg border border-border bg-muted/30 px-3 py-2">
                            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                              Avant
                            </span>
                            <p className="text-sm text-muted-foreground line-through mt-0.5">
                              {evt.oldValue}
                            </p>
                          </div>
                          <div className="flex items-center justify-center shrink-0">
                            <ArrowRight className="w-4 h-4 text-muted-foreground rotate-90 sm:rotate-0" />
                          </div>
                          <div className="flex-1 rounded-lg border border-primary/20 bg-primary-soft/30 px-3 py-2">
                            <span className="text-[11px] font-medium text-primary uppercase tracking-wide">
                              Après
                            </span>
                            <p className="text-sm font-medium mt-0.5">{evt.newValue}</p>
                          </div>
                        </div>
                      )}

                      {/* Before/After for thumbnail changes */}
                      {evt.eventType === 'thumbnail_change' &&
                        evt.oldValue &&
                        evt.newValue && (
                          <div className="flex flex-col sm:flex-row gap-2 mt-2">
                            <div className="flex-1 rounded-lg border border-border bg-muted/30 p-2">
                              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">
                                Avant
                              </span>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={evt.oldValue}
                                alt="Ancienne miniature"
                                className="rounded w-full aspect-video object-cover opacity-60"
                              />
                            </div>
                            <div className="flex items-center justify-center shrink-0">
                              <ArrowRight className="w-4 h-4 text-muted-foreground rotate-90 sm:rotate-0" />
                            </div>
                            <div className="flex-1 rounded-lg border border-primary/20 bg-primary-soft/30 p-2">
                              <span className="text-[11px] font-medium text-primary uppercase tracking-wide block mb-1">
                                Après
                              </span>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={evt.newValue}
                                alt="Nouvelle miniature"
                                className="rounded w-full aspect-video object-cover"
                              />
                            </div>
                          </div>
                        )}

                      {/* Spike details */}
                      {evt.eventType === 'spike' && evt.meta && (
                        <div className="flex gap-4 mt-2 text-sm">
                          <span className="tabular-nums">
                            <span className="text-muted-foreground">Vues/h :</span>{' '}
                            <span className="font-semibold text-destructive">
                              {formatNumber(evt.meta.views_per_hour as number)}
                            </span>
                          </span>
                          <span className="tabular-nums">
                            <span className="text-muted-foreground">Médiane :</span>{' '}
                            {formatNumber(evt.meta.median_vph as number)}/h
                          </span>
                          <span className="tabular-nums">
                            <span className="text-muted-foreground">Multiplicateur :</span>{' '}
                            <span className="font-semibold">
                              {evt.meta.multiplier as number}×
                            </span>
                          </span>
                          <span className="tabular-nums">
                            <span className="text-muted-foreground">Vues totales :</span>{' '}
                            {formatNumber(evt.meta.current_views as number)}
                          </span>
                        </div>
                      )}

                      {/* View evolution after change */}
                      {(evt.eventType === 'title_change' ||
                        evt.eventType === 'thumbnail_change') &&
                        evt.viewsBefore !== null &&
                        evt.viewsAfter !== null && (
                          <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                            <TrendingUp className="w-3.5 h-3.5" />
                            <span>
                              {formatNumber(evt.viewsBefore)} → {formatNumber(evt.viewsAfter)} vues
                              {evt.viewsAfter > evt.viewsBefore && (
                                <span className="text-success ml-1">
                                  (+{formatNumber(evt.viewsAfter - evt.viewsBefore)})
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                    </div>

                    {/* Niche badge */}
                    <span className="text-[12px] text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 shrink-0">
                      {evt.nicheName}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-[10px] p-12 shadow-[0_1px_2px_rgba(20,24,34,0.06)] text-center">
            <ActivityIcon className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-[15px] font-medium">Aucun événement détecté</p>
            <p className="text-sm text-muted-foreground mt-1">
              Les événements apparaîtront ici après la prochaine collecte.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
