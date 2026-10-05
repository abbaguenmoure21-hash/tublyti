import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Upload, Type, Image as ImageIcon, TrendingUp } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope, labelsByNiche } from '@/lib/scope';

export const metadata: Metadata = { title: 'Veille' };

type Kind = 'new_upload' | 'title_change' | 'thumbnail_change' | 'spike';

const KINDS: { key: Kind | 'tous'; label: string }[] = [
  { key: 'tous', label: 'Tout' },
  { key: 'spike', label: 'Vidéos qui décollent' },
  { key: 'title_change', label: 'Titres changés' },
  { key: 'thumbnail_change', label: 'Miniatures changées' },
  { key: 'new_upload', label: 'Nouvelles vidéos' },
];

const BADGE: Record<Kind, { label: string; icon: typeof Upload; tone: string }> = {
  spike: { label: 'Décolle', icon: TrendingUp, tone: 'bg-phase-2-soft text-phase-2-ink' },
  title_change: { label: 'Titre changé', icon: Type, tone: 'bg-primary-soft text-primary-ink' },
  thumbnail_change: { label: 'Miniature changée', icon: ImageIcon, tone: 'bg-phase-1-soft text-phase-1-ink' },
  new_upload: { label: 'Nouvelle vidéo', icon: Upload, tone: 'bg-muted text-muted-foreground' },
};

interface EventRow {
  id: string;
  videoId: string;
  kind: Kind;
  oldValue: string | null;
  newValue: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  title: string;
  thumbnail: string;
  channel: string;
  subscribers: number;
  myChannel: string;
  viewsBefore: number | null;
  viewsAfter: number | null;
}

const nf = new Intl.NumberFormat('fr-FR');
function compact(n: number): string {
  if (n >= 1_000_000) return `${nf.format(Math.round(n / 100_000) / 10)} M`;
  if (n >= 1_000) return `${nf.format(Math.round(n / 100) / 10)} k`;
  return nf.format(n);
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Hier';
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Miniature YouTube : l'adresse enregistrée, sinon l'image standard de la vidéo. */
function thumb(videoId: string, url: string | null): string {
  return url && url.startsWith('http') ? url : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

export default async function VeillePage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const params = await searchParams;
  const user = await requireUser();
  const db = createServiceClient();
  const { scope, scopeLabel, nicheIds, niches } = await resolveScope(db, user.id);
  const ids = nicheIds.length ? nicheIds : ['00000000-0000-0000-0000-000000000000'];
  const labelByNiche = labelsByNiche(niches);

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: raw } = await db
    .from('video_events')
    .select(
      `id, video_id, event_type, old_value, new_value, meta, created_at,
       videos!inner(id, title, thumbnail_url, channels!inner(id, title, subscriber_count, niche_id))`,
    )
    .gte('created_at', since)
    .in('videos.channels.niche_id', ids)
    .order('created_at', { ascending: false })
    .limit(200);

  const all: EventRow[] = ((raw ?? []) as Record<string, unknown>[]).map((e) => {
    const v = e.videos as unknown as {
      id: string; title: string; thumbnail_url: string | null;
      channels: { id: string; title: string; subscriber_count: number | null; niche_id: string };
    };
    return {
      id: e.id as string,
      videoId: e.video_id as string,
      kind: e.event_type as Kind,
      oldValue: (e.old_value as string | null) ?? null,
      newValue: (e.new_value as string | null) ?? null,
      meta: (e.meta as Record<string, unknown> | null) ?? null,
      createdAt: e.created_at as string,
      title: v.title,
      thumbnail: thumb(v.id, v.thumbnail_url),
      channel: v.channels.title,
      subscribers: v.channels.subscriber_count ?? 0,
      myChannel: labelByNiche.get(v.channels.niche_id) ?? '',
      viewsBefore: null,
      viewsAfter: null,
    };
  });

  const counts: Record<string, number> = { tous: all.length };
  for (const e of all) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  const kind = KINDS.some((k) => k.key === params.type) ? (params.type as Kind) : 'tous';
  const events = kind === 'tous' ? all : all.filter((e) => e.kind === kind);

  // Vues avant / après un changement de titre ou de miniature : une seule requête.
  const changed = events.filter((e) => e.kind === 'title_change' || e.kind === 'thumbnail_change').slice(0, 80);
  if (changed.length) {
    const { data: snaps } = await db
      .from('video_snapshots')
      .select('video_id, captured_at, views')
      .in('video_id', [...new Set(changed.map((e) => e.videoId))])
      .gte('captured_at', new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order('captured_at', { ascending: true })
      .limit(5000);
    const byVideo = new Map<string, { t: number; views: number }[]>();
    for (const s of (snaps ?? []) as { video_id: string; captured_at: string; views: number | null }[]) {
      const list = byVideo.get(s.video_id) ?? [];
      list.push({ t: new Date(s.captured_at).getTime(), views: Number(s.views ?? 0) });
      byVideo.set(s.video_id, list);
    }
    for (const e of changed) {
      const list = byVideo.get(e.videoId) ?? [];
      const at = new Date(e.createdAt).getTime();
      const before = [...list].reverse().find((s) => s.t <= at);
      const after = list[list.length - 1];
      if (before && after && after.t > at) {
        e.viewsBefore = before.views;
        e.viewsAfter = after.views;
      }
    }
  }

  // Regroupement par jour
  const groups: { day: string; items: EventRow[] }[] = [];
  for (const e of events) {
    const day = dayLabel(e.createdAt);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(e);
    else groups.push({ day, items: [e] });
  }

  const href = (k: string) => (k === 'tous' ? '/activity' : `/activity?type=${k}`);

  return (
    <div className="flex flex-col gap-6 px-4 pb-12 pt-5 md:px-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">
          {scopeLabel ? `À voir cette semaine · ${scopeLabel}` : 'À voir cette semaine'}
        </h1>
        <p className="max-w-[760px] text-[15px] leading-relaxed text-muted-foreground">
          Ce que font les chaînes de tes thématiques depuis 14 jours. Une vidéo qui décolle signale un sujet qui plaît ; un titre ou une miniature
          changés montrent ce que les créateurs testent pour gagner des vues.
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
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-3 text-[13px] transition-all ${
                on ? 'elev-1 bg-card font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              {k.label}
              <span className="text-[12px] font-normal tabular-nums text-muted-foreground">{counts[k.key] ?? 0}</span>
            </Link>
          );
        })}
      </nav>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <p className="text-[15px] font-medium">Rien de nouveau pour ce filtre depuis 14 jours.</p>
          <p className="max-w-md text-sm text-muted-foreground">La veille se met à jour chaque nuit avec les chaînes que TubLyTI analyse dans tes thématiques.</p>
          {kind !== 'tous' && (
            <Link href="/activity" className="mt-1 text-sm font-semibold text-primary">
              Voir tout
            </Link>
          )}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.day} aria-label={g.day} className="flex flex-col gap-2">
            <h2 className="px-1 text-[13px] font-semibold text-muted-foreground">{g.day}</h2>
            <ul className="overflow-hidden rounded-2xl bg-card">
              {g.items.map((e) => {
                const b = BADGE[e.kind] ?? BADGE.new_upload;
                const gain =
                  e.viewsBefore != null && e.viewsAfter != null && e.viewsBefore > 0
                    ? Math.round(((e.viewsAfter - e.viewsBefore) / e.viewsBefore) * 100)
                    : null;
                const multiplier = typeof e.meta?.multiplier === 'number' ? (e.meta.multiplier as number) : null;
                return (
                  <li key={e.id} className="border-b border-muted last:border-b-0">
                    <a
                      href={`https://www.youtube.com/watch?v=${e.videoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex gap-4 px-4 py-4 transition-colors hover:bg-muted/50 md:px-5"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={e.kind === 'thumbnail_change' && e.newValue?.startsWith('http') ? e.newValue : e.thumbnail}
                        alt=""
                        loading="lazy"
                        className="elev-1 aspect-video w-[132px] shrink-0 rounded-[10px] bg-muted object-cover md:w-[176px]"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold ${b.tone}`}>
                            <b.icon className="h-3.5 w-3.5" aria-hidden="true" />
                            {b.label}
                          </span>
                          <span className="font-medium text-foreground">{e.channel}</span>
                          <span>· {compact(e.subscribers)} abonnés</span>
                          {!scope && e.myChannel && <span>· {e.myChannel}</span>}
                        </div>

                        {e.kind === 'title_change' ? (
                          <div className="flex flex-col gap-1">
                            <p className="text-[15px] font-semibold leading-snug">{e.newValue ?? e.title}</p>
                            {e.oldValue && <p className="text-[13px] leading-snug text-muted-foreground">Avant : {e.oldValue}</p>}
                          </div>
                        ) : (
                          <p className="text-[15px] font-semibold leading-snug">{e.title}</p>
                        )}

                        {e.kind === 'thumbnail_change' && e.oldValue?.startsWith('http') && (
                          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                            Avant :
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={e.oldValue} alt="Ancienne miniature" loading="lazy" className="aspect-video w-[88px] rounded-md object-cover opacity-80" />
                          </div>
                        )}

                        <p className="text-[13px] text-muted-foreground">
                          {e.kind === 'spike' && multiplier
                            ? `${nf.format(multiplier)} fois plus de vues par heure que d’habitude pour cette chaîne`
                            : gain !== null
                              ? `${gain >= 0 ? '+' : ''}${gain} % de vues depuis le changement`
                              : null}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 hidden h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 md:block" aria-hidden="true" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
