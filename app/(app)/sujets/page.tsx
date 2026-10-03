import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, SearchX } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveScope } from '@/lib/scope';
import { requireUser } from '@/lib/auth/session';
import { listTopics, getTopicDetail, parseMoments, DEFAULT_MOMENTS } from '@/lib/sujets/queries';
import { PhaseBadge } from '@/components/tublyti/phase-badge';
import { SensitiveBadge } from '@/components/tublyti/sensitive-badge';
import { ReliabilityMark, PotentialMeter } from './_components/reliability';
import { SearchField } from './_components/search-field';
import { ListKeyboard } from './_components/list-keyboard';
import { Inspector } from './_components/inspector';
import { TopicActions } from './_components/topic-actions';
import { sujetsHref, type SujetsParams } from './_components/url';

export const metadata: Metadata = { title: 'Sujets' };

const MOMENT_CHIPS: { value: string; label: string }[] = [
  { value: '2,1,0', label: 'À traiter' },
  { value: '2', label: 'C’est le moment' },
  { value: '1', label: 'Ça monte' },
  { value: '0', label: 'À surveiller' },
  { value: '3', label: 'Trop tard' },
  { value: 'tous', label: 'Tous' },
];

const nf = new Intl.NumberFormat('fr-FR');

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export default async function SujetsPage({ searchParams }: { searchParams: Promise<SujetsParams> }) {
  const params = await searchParams;
  const user = await requireUser();
  const db = createServiceClient();
  const { scope, nicheIds, niches } = await resolveScope(db, user.id);

  // Premier lancement : aucune chaîne encore ajoutée.
  if (!niches.length) redirect('/bienvenue');

  const moments = parseMoments(params.moment);
  const momentKey = params.moment ?? DEFAULT_MOMENTS.join(',');
  const reliableOnly = params.fiable === '1';

  const { rows, scoredAt } = await listTopics(db, { userId: user.id, nicheIds, moments, reliableOnly, query: params.q ?? '' });
  const nicheById = new Map(niches.map((n) => [n.id, n]));
  const scopeLabel = scope ? nicheById.get(scope)?.label : null;

  const selectedIndex = params.sujet ? rows.findIndex((r) => r.id === params.sujet) : -1;
  const detail = params.sujet ? await getTopicDetail(db, params.sujet, user.id) : null;
  const ids = rows.map((r) => r.id);
  const hrefAt = (i: number) => (i >= 0 && i < rows.length ? sujetsHref(params, { sujet: rows[i].id }) : null);
  const filtered = Boolean(params.q) || reliableOnly || momentKey !== DEFAULT_MOMENTS.join(',');

  return (
    <div className="flex min-h-full">
      <ListKeyboard ids={ids} params={params} />

      <div className="flex min-w-0 flex-1 flex-col gap-5 px-4 pb-10 pt-5 md:px-8">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">
            {scopeLabel ? `Les meilleurs sujets pour ${scopeLabel}` : 'Tes meilleurs sujets cette semaine'}
          </h1>
          <p className="text-[15px] text-muted-foreground">
            {nf.format(rows.length)} sujet{rows.length > 1 ? 's' : ''} classé{rows.length > 1 ? 's' : ''} par potentiel · mis à jour le {formatDate(scoredAt)}.{' '}
            <span className="hidden md:inline">Clique sur un sujet pour le voir sans quitter la liste.</span>
          </p>
        </header>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchField params={params} />
          <div role="group" aria-label="Filtrer par moment" className="flex flex-wrap gap-1.5">
            {MOMENT_CHIPS.map((c) => {
              const on = c.value === momentKey;
              return (
                <Link
                  key={c.value}
                  href={sujetsHref(params, { moment: c.value === '2,1,0' ? null : c.value, sujet: null })}
                  scroll={false}
                  aria-pressed={on}
                  className={`flex h-8 items-center rounded-full px-3 text-[13px] font-medium transition-colors ${
                    on ? 'bg-foreground text-background' : 'bg-card text-foreground ring-1 ring-inset ring-border hover:bg-muted'
                  }`}
                >
                  {c.label}
                </Link>
              );
            })}
            <Link
              href={sujetsHref(params, { fiable: reliableOnly ? null : '1', sujet: null })}
              scroll={false}
              aria-pressed={reliableOnly}
              className={`flex h-8 items-center rounded-full px-3 text-[13px] font-medium transition-colors ${
                reliableOnly ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground ring-1 ring-inset ring-border hover:bg-muted'
              }`}
            >
              Fiables uniquement
            </Link>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
            <SearchX className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-[15px] font-medium">Aucun sujet ne correspond à ces filtres.</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {momentKey === '2' ? 'Aucun sujet n’est en « C’est le moment » pour l’instant. Regarde ceux qui montent.' : 'Élargis les filtres pour voir plus de sujets.'}
            </p>
            <Link href={momentKey === '2' ? sujetsHref({}, { moment: '1' }) : '/sujets'} className="mt-1 text-sm font-semibold text-primary">
              {momentKey === '2' ? 'Voir les sujets qui montent' : 'Réinitialiser les filtres'}
            </Link>
          </div>
        ) : (
          <section aria-label="Liste des sujets" className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="hidden grid-cols-[32px_minmax(0,1fr)_140px_116px_132px_20px] gap-4 border-b border-border bg-background px-5 py-2.5 text-xs font-medium text-muted-foreground md:grid">
              <span>#</span>
              <span>Sujet</span>
              <span>Moment</span>
              <span>Potentiel</span>
              <span>Fiabilité</span>
              <span />
            </div>
            <ol>
              {rows.map((r, i) => {
                const niche = nicheById.get(r.nicheId);
                const selected = r.id === params.sujet;
                return (
                  <li key={r.id} className="border-b border-muted last:border-b-0">
                    <Link
                      id={`sujet-${r.id}`}
                      href={sujetsHref(params, { sujet: selected ? null : r.id })}
                      scroll={false}
                      aria-current={selected ? 'true' : undefined}
                      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors md:grid-cols-[32px_minmax(0,1fr)_140px_116px_132px_20px] md:px-5 ${
                        selected ? 'bg-primary-soft/50 shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-muted/60'
                      }`}
                    >
                      <span className="hidden text-[13px] tabular-nums text-muted-foreground md:block">{i + 1}</span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-semibold">{r.label}</span>
                          {r.inMyVideos && (
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Dans Mes vidéos</span>
                          )}
                          {r.sensitive && <SensitiveBadge />}
                        </span>
                        {niche && (
                          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                            <span className="h-[7px] w-[7px] rounded-full" style={{ background: niche.color }} aria-hidden="true" />
                            {niche.label}
                          </span>
                        )}
                      </span>
                      <span className="md:block"><PhaseBadge phase={r.phase} /></span>
                      <span className="col-span-2 flex items-center gap-4 md:contents">
                        <PotentialMeter value={r.potential} />
                        <ReliabilityMark value={r.reliability} />
                      </span>
                      <ChevronRight className="hidden h-4 w-4 text-muted-foreground md:block" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <p className="hidden text-xs text-muted-foreground md:block">
          Raccourcis : <kbd className="font-semibold">J</kbd> / <kbd className="font-semibold">K</kbd> sujet suivant ou précédent ·{' '}
          <kbd className="font-semibold">Entrée</kbd> ouvrir · <kbd className="font-semibold">C</kbd> créer la vidéo ·{' '}
          <kbd className="font-semibold">X</kbd> ignorer · <kbd className="font-semibold">/</kbd> chercher · <kbd className="font-semibold">Échap</kbd> fermer
          {filtered && (
            <>
              {' · '}
              <Link href="/sujets" className="font-semibold text-primary">Réinitialiser les filtres</Link>
            </>
          )}
        </p>
      </div>

      {params.sujet && detail && (
        <Inspector
          position={selectedIndex >= 0 ? `Sujet ${selectedIndex + 1} sur ${rows.length}` : 'Sujet hors des filtres'}
          prevHref={hrefAt(selectedIndex - 1)}
          nextHref={hrefAt(selectedIndex + 1)}
          closeHref={sujetsHref(params, { sujet: null })}
        >
          <div className="flex flex-col gap-2.5">
            <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: nicheById.get(detail.nicheId)?.color ?? 'var(--muted-foreground)' }} aria-hidden="true" />
              {nicheById.get(detail.nicheId)?.label ?? detail.nicheName}
            </span>
            <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.01em]">{detail.label}</h2>
            <div className="flex flex-wrap items-center gap-3">
              <PhaseBadge phase={detail.phase} />
              <ReliabilityMark value={detail.reliability} />
              {detail.sensitive && <SensitiveBadge />}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-background px-4 py-3.5">
            <span className="text-[13px] font-semibold">Pourquoi ce sujet</span>
            <p className="text-sm leading-relaxed">
              {detail.potential != null ? (
                <>
                  Potentiel <strong>{detail.potential}/100</strong>
                  {selectedIndex === 0 && !filtered ? ', le meilleur de la liste' : ''}.{' '}
                </>
              ) : (
                'Pas encore assez de données pour calculer le potentiel. '
              )}
              <strong>{nf.format(detail.videoCount90d)}</strong> vidéo{detail.videoCount90d > 1 ? 's' : ''} publiée{detail.videoCount90d > 1 ? 's' : ''} en 90 jours par{' '}
              <strong>{detail.channelCount}</strong> chaîne{detail.channelCount > 1 ? 's' : ''}.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">Ce que réclame le public</span>
            {detail.sensitive ? (
              <p className="text-sm text-muted-foreground">Sujet sensible : les citations ne sont pas affichées.</p>
            ) : detail.quotes.length ? (
              detail.quotes.map((q, i) => (
                <blockquote key={i} className="border-l-2 border-primary/30 pl-3 text-sm leading-relaxed">
                  « {q.text} » <span className="text-muted-foreground">· {nf.format(q.likes)} like{q.likes > 1 ? 's' : ''}</span>
                </blockquote>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Aucune question du public repérée pour l’instant sur ce sujet.</p>
            )}
          </div>

          <TopicActions
            key={detail.id}
            topicId={detail.id}
            topicLabel={detail.label}
            inProduction={detail.inMyVideos}
            angles={detail.angles}
            afterIgnoreHref={hrefAt(selectedIndex + 1) ?? hrefAt(selectedIndex - 1) ?? sujetsHref(params, { sujet: null })}
          />
        </Inspector>
      )}
    </div>
  );
}
