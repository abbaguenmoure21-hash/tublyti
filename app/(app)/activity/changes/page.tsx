import type { Metadata } from 'next';
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { History } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { byBestEffect, CHANGES_WINDOW_DAYS, getChanges, MIN_PACE_BEFORE, topicsByVideo, type ChangeKind } from '@/lib/changes';
import { ChangeItem, formatNumber } from '../_components/change-parts';

export const metadata: Metadata = { title: 'Titres et miniatures modifiés' };
export const dynamic = 'force-dynamic';

/**
 * Data only changes once a night: cache per scope for an hour. Tabs and sort are applied in memory,
 * so switching them does not re-read video_snapshots.
 */
const loadChanges = unstable_cache(
  async (nicheKey: string) => {
    const db = createServiceClient();
    const nicheIds = nicheKey === '*' ? null : nicheKey ? nicheKey.split(',') : [];
    const all = await getChanges(db, { nicheIds, days: CHANGES_WINDOW_DAYS });
    const topics = await topicsByVideo(db, all.map((c) => c.videoId), nicheIds);
    return { all, topics: Object.fromEntries(topics) };
  },
  ['activity-changes-v2'],
  { revalidate: 3600 },
);

const KINDS = [
  { key: 'tous', label: 'Tout' },
  { key: 'titre', label: 'Titres' },
  { key: 'miniature', label: 'Miniatures' },
] as const;

const SEG = 'flex h-10 shrink-0 items-center rounded-[9px] px-3 text-[13px] md:h-8';

export default async function ChangesPage({ searchParams }: { searchParams: Promise<{ type?: string; tri?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const db = createServiceClient();
  const { nicheIds, scopeLabel } = await resolveScope(db, user.id);
  const kind: ChangeKind | null = sp.type === 'titre' ? 'title_change' : sp.type === 'miniature' ? 'thumbnail_change' : null;
  const sort = sp.tri === 'recent' ? 'recent' : 'effet';

  const { all: everything, topics } = await loadChanges(nicheIds ? [...nicheIds].sort().join(',') : '*');
  const all = kind ? everything.filter((c) => c.kind === kind) : everything;
  const measured = all.filter((c) => c.effect !== null);
  const up = measured.filter((c) => (c.effect ?? 0) >= 1.3).length;
  const down = measured.filter((c) => (c.effect ?? 0) < 0.8).length;
  const flat = measured.length - up - down;
  const rows = sort === 'effet' ? [...all].sort(byBestEffect) : all;
  const href = (k: string, t = sort) => {
    const qs = new URLSearchParams({ ...(k !== 'tous' ? { type: k } : {}), ...(t !== 'effet' ? { tri: t } : {}) }).toString();
    return qs ? `/activity/changes?${qs}` : '/activity/changes';
  };
  const currentKind = sp.type === 'titre' || sp.type === 'miniature' ? sp.type : 'tous';
  const kindWord = kind === 'title_change' ? 'titre' : kind === 'thumbnail_change' ? 'miniature' : 'titre ni miniature';

  return (
    <div className="flex flex-col gap-6 px-4 pb-12 pt-5 md:px-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">
          Quels titres et miniatures ont marché ?{scopeLabel ? ` · ${scopeLabel}` : ''}
        </h1>
        <p className="max-w-[780px] text-[15px] leading-relaxed text-muted-foreground">
          Les changements des {CHANGES_WINDOW_DAYS} derniers jours dans tes thématiques, avec le rythme de vues avant et après.
        </p>
        <details className="max-w-[780px] text-[13px] text-muted-foreground">
          <summary className="inline-flex min-h-10 cursor-pointer items-center font-medium text-foreground md:min-h-0">Comment c’est mesuré</summary>
          <p className="mt-1 leading-relaxed">
            TubLyTI compare le rythme de vues (vues par jour) de la semaine d’avant au rythme depuis. Une vidéo ralentit normalement en vieillissant :
            quand le rythme <strong className="font-medium text-foreground">remonte</strong>, le nouveau titre ou la nouvelle miniature marche mieux.
            Un changement n’est jugé que si la vidéo faisait au moins {MIN_PACE_BEFORE} vues par jour et avait au moins 3 jours. Les relevés de vues
            sont gardés {CHANGES_WINDOW_DAYS} jours : au-delà, on ne peut plus mesurer.
          </p>
        </details>
      </header>

      <dl className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-card px-3 py-3 md:px-4">
          <dt className="text-[12px] text-muted-foreground">Changements repérés</dt>
          <dd className="text-[18px] font-semibold tabular-nums md:text-[22px]">{formatNumber(all.length)}</dd>
        </div>
        <div className="rounded-2xl bg-card px-3 py-3 md:px-4">
          <dt className="text-[12px] text-muted-foreground">Mesurables</dt>
          <dd className="text-[18px] font-semibold tabular-nums md:text-[22px]">{formatNumber(measured.length)}</dd>
        </div>
        <div className="rounded-2xl bg-card px-3 py-3 md:px-4">
          <dt className="text-[12px] text-muted-foreground">Ont relancé la vidéo</dt>
          <dd className="text-[18px] font-semibold tabular-nums md:text-[22px]">{measured.length ? formatNumber(up) : '—'}</dd>
          {measured.length > 0 && (
            <dd className="text-[12px] text-muted-foreground">
              {formatNumber(flat)} sans effet · {formatNumber(down)} en baisse
            </dd>
          )}
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Type de changement" className="well inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[12px] bg-muted p-[3px]">
          {KINDS.map((k) => (
            <Link
              key={k.key}
              href={href(k.key)}
              scroll={false}
              aria-current={currentKind === k.key ? 'true' : undefined}
              className={`${SEG} ${currentKind === k.key ? 'elev-1 bg-card font-semibold' : 'font-medium text-muted-foreground hover:text-foreground'}`}
            >
              {k.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Tri" className="well inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[12px] bg-muted p-[3px]">
          {[
            { key: 'effet', label: 'Ce qui a le mieux marché', short: 'Meilleurs' },
            { key: 'recent', label: 'Les plus récents', short: 'Récents' },
          ].map((t) => (
            <Link
              key={t.key}
              href={href(currentKind, t.key)}
              scroll={false}
              aria-current={sort === t.key ? 'true' : undefined}
              className={`${SEG} ${sort === t.key ? 'elev-1 bg-card font-semibold' : 'font-medium text-muted-foreground hover:text-foreground'}`}
            >
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <History className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-[15px] font-medium">Aucun changement de {kindWord} depuis {CHANGES_WINDOW_DAYS} jours.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Les titres sont surveillés à chaque relevé de vues ; les miniatures chaque nuit pour les vidéos des 45 derniers jours.
          </p>
          {kind ? (
            <Link href={href('tous')} className="mt-1 inline-flex min-h-10 items-center text-sm font-semibold text-primary">
              Voir tous les changements
            </Link>
          ) : (
            <Link href="/settings#thematiques" className="mt-1 inline-flex min-h-10 items-center text-sm font-semibold text-primary">
              Suivre une thématique de plus
            </Link>
          )}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-card">
          {rows.map((c) => (
            <li key={c.id} className="border-b border-muted last:border-b-0">
              <ChangeItem change={c} topic={topics[c.videoId] ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
