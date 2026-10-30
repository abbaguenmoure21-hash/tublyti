import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Radar, TrendingUp, Upload } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope, labelsByNiche } from '@/lib/scope';
import { getChanges, topicsByVideo, type ChangeRow } from '@/lib/changes';
import { ChangeItem, DISPLAY_TZ, KindBadge, RowActions, ageLabel, formatCompact, formatNumber, formatTimes, relativeTime, ytThumb } from './_components/change-parts';

export const metadata: Metadata = { title: 'Veille' };

type Kind = 'new_upload' | 'title_change' | 'thumbnail_change' | 'spike';
const ALL_KINDS: Kind[] = ['spike', 'title_change', 'thumbnail_change', 'new_upload'];
const SIGNAL_KINDS: Kind[] = ['spike', 'title_change', 'thumbnail_change'];

/** « À voir cette semaine » : the title promises a week, so the window is a week. */
const WINDOW_DAYS = 7;
const LIST_LIMIT = 200;
const NEW_UPLOADS_PREVIEW = 8;
const NO_NICHE = '00000000-0000-0000-0000-000000000000';

const KINDS: { key: Kind | 'tous'; label: string }[] = [
  { key: 'tous', label: 'Tout' },
  { key: 'spike', label: 'Vidéos qui surperforment' },
  { key: 'title_change', label: 'Titres changés' },
  { key: 'thumbnail_change', label: 'Miniatures changées' },
  { key: 'new_upload', label: 'Nouvelles vidéos' },
];

interface EventRow {
  id: string;
  videoId: string;
  kind: Kind;
  meta: Record<string, unknown> | null;
  createdAt: string;
  title: string;
  thumbnail: string;
  publishedAt: string | null;
  channel: string;
  subscribers: number;
  myChannel: string;
}

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayLong = new Intl.DateTimeFormat('fr-FR', { timeZone: DISPLAY_TZ, weekday: 'long', day: 'numeric', month: 'long' });

/** Day header in the display time zone (the server runs in UTC). */
function dayLabel(iso: string, now = new Date()): string {
  const k = dayKey.format(new Date(iso));
  if (k === dayKey.format(now)) return 'Aujourd’hui';
  if (k === dayKey.format(new Date(now.getTime() - 86_400_000))) return 'Hier';
  const s = dayLong.format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function thumb(videoId: string, url: string | null): string {
  return url && url.startsWith('http') ? url : ytThumb(videoId);
}

/** Request-time window start (kept out of the component body: server-only, computed once per request). */
function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

const multiplierOf = (e: EventRow) => (typeof e.meta?.multiplier === 'number' ? (e.meta.multiplier as number) : 0);

const SELECT = `id, video_id, event_type, meta, created_at,
  videos!inner(id, title, thumbnail_url, published_at, channels!inner(id, title, subscriber_count, niche_id))`;

export default async function VeillePage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const params = await searchParams;
  const user = await requireUser();
  const db = createServiceClient();
  const { scope, scopeLabel, nicheIds, niches } = await resolveScope(db, user.id);
  const ids = nicheIds.length ? nicheIds : [NO_NICHE];
  const labelByNiche = labelsByNiche(niches);
  const kind = KINDS.some((k) => k.key === params.type) ? (params.type as Kind) : 'tous';
  const since = sinceIso(WINDOW_DAYS);

  const base = (types: Kind[], limit: number) =>
    db
      .from('video_events')
      .select(SELECT)
      .in('event_type', types)
      .gte('created_at', since)
      .in('videos.channels.niche_id', ids)
      .order('created_at', { ascending: false })
      .limit(limit);
  const countOf = (t: Kind) =>
    db
      .from('video_events')
      .select('id, videos!inner(channels!inner(niche_id))', { count: 'exact', head: true })
      .eq('event_type', t)
      .gte('created_at', since)
      .in('videos.channels.niche_id', ids);

  // Filter in SQL (not after a mixed LIMIT), and exact counts per type in parallel.
  const [listRes, uploadsRes, ...countRes] = await Promise.all([
    base(kind === 'tous' ? SIGNAL_KINDS : [kind], LIST_LIMIT),
    kind === 'tous' ? base(['new_upload'], NEW_UPLOADS_PREVIEW) : Promise.resolve({ data: [], error: null }),
    ...ALL_KINDS.map(countOf),
  ]);
  const firstError = [listRes, uploadsRes, ...countRes].find((r) => r.error)?.error;
  if (firstError) throw new Error(`Veille: ${firstError.message}`);

  const counts: Record<string, number> = {};
  ALL_KINDS.forEach((k, i) => (counts[k] = countRes[i].count ?? 0));
  counts.tous = ALL_KINDS.reduce((s, k) => s + counts[k], 0);

  const toRow = (e: Record<string, unknown>): EventRow => {
    const v = e.videos as unknown as {
      id: string; title: string; thumbnail_url: string | null; published_at: string | null;
      channels: { id: string; title: string; subscriber_count: number | null; niche_id: string };
    };
    return {
      id: e.id as string,
      videoId: e.video_id as string,
      kind: e.event_type as Kind,
      meta: (e.meta as Record<string, unknown> | null) ?? null,
      createdAt: e.created_at as string,
      title: v.title,
      thumbnail: thumb(v.id, v.thumbnail_url),
      publishedAt: v.published_at,
      channel: v.channels.title,
      subscribers: v.channels.subscriber_count ?? 0,
      myChannel: labelByNiche.get(v.channels.niche_id) ?? '',
    };
  };
  const listed = ((listRes.data ?? []) as Record<string, unknown>[]).map(toRow);
  const truncated = listed.length >= LIST_LIMIT;

  // One line per video: keep the strongest spike, and fold a spike into the change row of the same video.
  const bestSpike = new Map<string, EventRow>();
  for (const e of listed) {
    if (e.kind !== 'spike') continue;
    const cur = bestSpike.get(e.videoId);
    if (!cur || multiplierOf(e) > multiplierOf(cur)) bestSpike.set(e.videoId, e);
  }
  const changeVideos = new Set(listed.filter((e) => e.kind !== 'spike').map((e) => e.videoId));
  const seenChange = new Set<string>();
  const events = listed.filter((e) => {
    if (e.kind === 'spike') return bestSpike.get(e.videoId) === e && (kind === 'spike' || !changeVideos.has(e.videoId));
    if (e.kind === 'title_change' || e.kind === 'thumbnail_change') {
      if (kind !== 'tous') return true;
      const k = `${e.videoId}`;
      if (seenChange.has(k)) return false;
      seenChange.add(k);
    }
    return true;
  });
  const signalVideos = new Set(events.map((e) => e.videoId));
  const uploads = ((uploadsRes.data ?? []) as Record<string, unknown>[]).map(toRow).filter((e) => !signalVideos.has(e.videoId));

  // Title / thumbnail changes: same measure and verdict as /activity/changes.
  const changeIds = events.filter((e) => e.kind === 'title_change' || e.kind === 'thumbnail_change').map((e) => e.id);
  const [changeRows, topics] = await Promise.all([
    changeIds.length ? getChanges(db, { nicheIds, eventIds: changeIds, limit: changeIds.length }) : Promise.resolve([] as ChangeRow[]),
    topicsByVideo(db, [...events, ...uploads].map((e) => e.videoId), nicheIds),
  ]);
  const changeById = new Map(changeRows.map((c) => [c.id, c]));

  const groups: { day: string; items: EventRow[] }[] = [];
  for (const e of events) {
    const day = dayLabel(e.createdAt);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(e);
    else groups.push({ day, items: [e] });
  }

  const href = (k: string) => (k === 'tous' ? '/activity' : `/activity?type=${k}`);
  const hasChanges = changeIds.length > 0;

  const renderRow = (e: EventRow) => {
    const topic = topics.get(e.videoId) ?? null;
    const spike = bestSpike.get(e.videoId);
    const change = changeById.get(e.id);
    if (change) {
      return (
        <ChangeItem
          change={change}
          topic={topic}
          extraMeta={kind === 'tous' && spike ? <span className="font-medium text-primary-ink">· Surperforme {formatTimes(multiplierOf(spike))}</span> : null}
        />
      );
    }
    const isSpike = e.kind === 'spike';
    const views = typeof e.meta?.current_views === 'number' ? (e.meta.current_views as number) : null;
    return (
      <div className="flex gap-4 px-4 py-4 md:px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={e.thumbnail} alt="" loading="lazy" className="elev-1 aspect-video w-[132px] shrink-0 self-start rounded-[10px] bg-muted object-cover md:w-[176px]" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
            {e.kind === 'title_change' || e.kind === 'thumbnail_change' ? (
              <KindBadge kind={e.kind} />
            ) : (
              <span
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold ${
                  isSpike ? 'bg-primary-soft text-primary-ink' : 'bg-muted text-muted-foreground'
                }`}
              >
                {isSpike ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
                {isSpike ? 'Surperforme' : 'Nouvelle vidéo'}
              </span>
            )}
            <span className="font-medium text-foreground">{e.channel}</span>
            <span>· {formatCompact(e.subscribers)} abonnés</span>
            <span>· {relativeTime(e.createdAt)}</span>
            {!scope && e.myChannel && <span>· {e.myChannel}</span>}
          </div>
          <p className="text-[15px] font-semibold leading-snug">{e.title}</p>
          {topic && <p className="text-[13px] text-muted-foreground">sujet : {topic.label}</p>}
          {isSpike && multiplierOf(e) > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {formatTimes(multiplierOf(e))} le rythme habituel de la chaîne
              {views !== null ? ` · ${formatCompact(views)} vues` : ''}
              {e.publishedAt ? ` en ${ageLabel(e.publishedAt)}` : ''}
            </p>
          )}
          <RowActions videoId={e.videoId} topic={topic} />
        </div>
      </div>
    );
  };

  const list = (items: EventRow[]) => (
    <ul className="overflow-hidden rounded-2xl bg-card">
      {items.map((e) => (
        <li key={e.id} className="border-b border-muted last:border-b-0">
          {renderRow(e)}
        </li>
      ))}
    </ul>
  );

  const empty = groups.length === 0 && uploads.length === 0;

  return (
    <div className="flex flex-col gap-6 px-4 pb-12 pt-5 md:px-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">
          Que se passe-t-il dans ta niche ?{scopeLabel ? ` · ${scopeLabel}` : ''}
        </h1>
        <p className="max-w-[760px] text-[15px] leading-relaxed text-muted-foreground">
          Ce que font les chaînes de tes thématiques depuis {WINDOW_DAYS} jours. Une vidéo qui surperforme signale un sujet qui plaît ; un titre ou une
          miniature changés montrent ce que les créateurs testent pour gagner des vues.
        </p>
      </header>

      <nav aria-label="Filtrer par type" className="well inline-flex max-w-full gap-0.5 self-start overflow-x-auto rounded-[12px] bg-muted p-[3px]">
        {KINDS.map((k) => {
          const on = k.key === kind;
          return (
            <Link
              key={k.key}
              href={href(k.key)}
              scroll={false}
              aria-current={on ? 'true' : undefined}
              className={`flex h-10 shrink-0 items-center gap-1.5 rounded-[9px] px-3 text-[13px] transition-all md:h-8 ${
                on ? 'elev-1 bg-card font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              {k.label}
              <span className="text-[12px] font-normal tabular-nums text-muted-foreground">{formatNumber(counts[k.key] ?? 0)}</span>
            </Link>
          );
        })}
      </nav>

      {empty ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <Radar className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-[15px] font-medium">
            {kind === 'tous' ? `Rien de nouveau depuis ${WINDOW_DAYS} jours.` : `Rien de nouveau pour ce filtre depuis ${WINDOW_DAYS} jours.`}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">La veille se met à jour chaque nuit avec les chaînes que TubLyTI analyse dans tes thématiques.</p>
          {kind !== 'tous' ? (
            <Link href="/activity" className="mt-1 inline-flex min-h-10 items-center text-sm font-semibold text-primary">
              Voir tout
            </Link>
          ) : (
            <Link href="/settings#thematiques" className="mt-1 inline-flex min-h-10 items-center text-sm font-semibold text-primary">
              Suivre une thématique de plus
            </Link>
          )}
        </div>
      ) : (
        <>
          {kind === 'tous' && groups.length > 0 && <h2 className="-mb-3 px-1 text-[17px] font-semibold">À retenir</h2>}
          {groups.map((g) => (
            <section key={g.day} aria-label={g.day} className="flex flex-col gap-2">
              <h3 className="px-1 text-[13px] font-semibold text-muted-foreground">{g.day}</h3>
              {list(g.items)}
            </section>
          ))}
          {truncated && <p className="px-1 text-[13px] text-muted-foreground">Les {LIST_LIMIT} plus récents sont affichés.</p>}
          {hasChanges && (
            <Link href="/activity/changes" className="inline-flex min-h-10 items-center gap-1 self-start px-1 text-sm font-semibold text-primary">
              Voir tous les changements <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          {kind === 'tous' && uploads.length > 0 && (
            <section aria-label="Nouvelles vidéos" className="flex flex-col gap-2">
              <h2 className="px-1 text-[17px] font-semibold">
                Nouvelles vidéos <span className="text-[13px] font-normal text-muted-foreground">· {formatNumber(counts.new_upload)} dans tes thématiques</span>
              </h2>
              {list(uploads)}
              {counts.new_upload > uploads.length && (
                <Link href={href('new_upload')} className="inline-flex min-h-10 items-center gap-1 self-start px-1 text-sm font-semibold text-primary">
                  Voir les {formatNumber(counts.new_upload)} nouvelles vidéos <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
