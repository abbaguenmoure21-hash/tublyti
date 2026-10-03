import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import {
  Upload,
  Type,
  Image,
  TrendingUp,
  ArrowRight,
  Activity as ActivityIcon,
} from 'lucide-react';
import { ActivityFilters } from './_components/activity-filters';

export const metadata = { title: 'Veille' };

interface EventRow {
  id: string;
  videoId: string;
  eventType: string;
  oldValue: string | null;
  newValue: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  videoTitle: string;
  thumbnailUrl: string | null;
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

  const user = await requireUser();
  const db = createServiceClient();
  const { nicheIds: allowed } = await resolveScope(db, user.id);
  const ids = allowed.length ? allowed : ['00000000-0000-0000-0000-000000000000'];

  // Thématiques du client uniquement
  const { data: niches } = await db
    .from('niches')
    .select('id, name')
    .eq('status', 'active')
    .in('id', ids)
    .order('name');

  // Fetch events (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let query = db
    .from('video_events')
    .select(
      `id, video_id, event_type, old_value, new_value, meta, created_at,
       videos!inner(id, title, thumbnail_url, channel_id, channels!inner(id, title, subscriber_count, niche_id, niches!inner(id, name)))`,
    )
    .gte('created_at', thirtyDaysAgo)
    .in('videos.channels.niche_id', ids)
    .order('created_at', { ascending: false })
    .limit(100);

  if (typeFilter) {
    query = query.eq('event_type', typeFilter);
  }
  if (nicheFilter && ids.includes(nicheFilter)) {
    query = query.eq('videos.channels.niche_id', nicheFilter);
  }

  const { data: rawEvents } = await query;

  // Map to typed rows
  let events: EventRow[] = (rawEvents ?? []).map((e: Record<string, unknown>) => {
    const video = e.videos as unknown as {
      id: string;
      title: string;
      thumbnail_url: string | null;
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
      thumbnailUrl: video.thumbnail_url,
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
    <div className="flex-1 flex flex-col min-h-full relative overflow-x-clip">
      {/* Background gradients multi-niveaux */}
      <div className="absolute inset-0 pointer-events-none -z-10">
      </div>



      <div className="flex-1 p-6 md:px-12 md:py-10 flex flex-col gap-8 overflow-x-hidden w-full max-w-[1400px] mx-auto">
        <div className="flex flex-col gap-2">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">À voir cette semaine</h1>
          <p className="text-[15px] text-muted-foreground">
            Ce qui bouge dans tes thématiques : nouvelles vidéos, titres ou miniatures changés, vidéos qui surperforment.
          </p>
        </div>

        <ActivityFilters niches={niches ?? []} />

        {events.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-max">
            {events.map((evt) => {
              const Icon = EVENT_ICONS[evt.eventType] ?? Upload;
              const colorClass = EVENT_COLORS[evt.eventType] ?? 'text-muted-foreground bg-muted';

              return (
                <div
                  key={evt.id}
                  className="group relative px-4 py-3.5 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl flex items-start gap-4 transition-all hover:shadow-[0_4px_20px_rgb(0,0,0,0.06)]"
                >
                  {/* Visual / Thumbnail */}
                  <div className="flex flex-col gap-1.5 shrink-0 w-[120px] pt-1">
                    {evt.eventType === 'thumbnail_change' && evt.oldValue && evt.newValue ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="relative aspect-video rounded-md overflow-hidden opacity-50 grayscale transition-all group-hover:opacity-100 group-hover:grayscale-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={evt.oldValue} alt="" className="object-cover w-full h-full" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[9px] uppercase tracking-wider font-bold bg-black/60 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">Avant</span>
                          </div>
                        </div>
                        <div className="relative aspect-video rounded-md overflow-hidden shadow-sm border border-black/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={evt.newValue} alt="" className="object-cover w-full h-full" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[9px] uppercase tracking-wider font-bold bg-green-500/80 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">Après</span>
                          </div>
                        </div>
                      </div>
                    ) : evt.thumbnailUrl && (evt.eventType === 'new_upload' || evt.eventType === 'spike') ? (
                      <div className="relative aspect-video rounded-lg overflow-hidden shadow-sm border border-black/5 mt-0.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={evt.thumbnailUrl} alt="" className="object-cover w-full h-full" />
                        <div
                          className={`absolute top-1.5 left-1.5 w-6 h-6 rounded-md flex items-center justify-center backdrop-blur-md shadow-sm ${colorClass}`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm mt-0.5 ${colorClass}`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                    )}
                    
                    {/* Niche Badge */}
                    <div className="flex items-center justify-center bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded py-0.5 px-1.5 w-full overflow-hidden mt-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground truncate" title={evt.nicheName}>
                        {evt.nicheName}
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center min-h-[40px] py-0.5">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                        <span className={`whitespace-nowrap ${colorClass.split(' ')[0]}`}>{EVENT_LABELS[evt.eventType] ?? evt.eventType}</span>
                      </div>
                      <span className="text-[12.5px] font-medium text-muted-foreground truncate">
                        {evt.channelTitle} <span className="text-[11.5px] opacity-70">({formatNumber(evt.subscriberCount)} abo)</span>
                      </span>
                    </div>
                    <Link
                      href={`https://youtube.com/watch?v=${evt.videoId}`}
                      target="_blank"
                      className="text-[14.5px] font-bold leading-snug mt-1.5 line-clamp-2 text-foreground/90 group-hover:text-foreground hover:text-primary transition-colors block"
                      title={evt.videoTitle}
                    >
                      {evt.videoTitle}
                    </Link>

                    {evt.eventType === 'spike' && evt.meta && (
                      <div className="mt-2.5">
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-destructive font-semibold px-2.5 py-1 rounded-md bg-destructive/10 border border-destructive/20">
                          <TrendingUp className="w-3.5 h-3.5" />
                          {evt.meta.multiplier as number}× la médiane
                        </span>
                      </div>
                    )}

                    {evt.eventType === 'title_change' && evt.oldValue && evt.newValue && (
                      <div className="mt-2.5 flex flex-col gap-1.5 bg-black/5 dark:bg-white/5 p-2.5 rounded-xl border border-black/5 dark:border-white/5">
                        <p className="text-[12px] text-muted-foreground line-through opacity-70 truncate" title={evt.oldValue}>
                          {evt.oldValue}
                        </p>
                        <p className="text-[13px] text-foreground font-medium truncate" title={evt.newValue}>
                          {evt.newValue}
                        </p>
                      </div>
                    )}
                      {/* View evolution after change */}
                      {(evt.eventType === 'title_change' ||
                        evt.eventType === 'thumbnail_change') &&
                        evt.viewsBefore !== null &&
                        evt.viewsAfter !== null && (
                          <div className="flex items-center gap-1.5 mt-2.5 text-[11px] font-semibold text-muted-foreground/80 bg-black/5 dark:bg-white/5 w-fit px-2 py-1 rounded-md">
                            <TrendingUp className="w-3 h-3" />
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
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[24px] p-12 text-center">
            <ActivityIcon className="w-8 h-8 text-muted-foreground/60 mx-auto mb-3" />
            <p className="text-[20px] font-bold tracking-tight text-foreground">Aucun événement détecté</p>
            <p className="text-sm text-muted-foreground mt-1">
              Les événements apparaîtront ici après la prochaine collecte.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
