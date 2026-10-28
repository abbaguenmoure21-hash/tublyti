import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Image as ImageIcon, Type } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { getChanges, type ChangeKind, type ChangeRow } from '@/lib/changes';

export const metadata: Metadata = { title: 'Titres et miniatures modifiés' };
export const dynamic = 'force-dynamic';

const nf = new Intl.NumberFormat('fr-FR');
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const times = (m: number) => `×${m.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;

function verdict(c: ChangeRow): { label: string; tone: string } {
  if (c.effect === null) return { label: c.daysAfter < 1.5 ? 'Trop récent' : 'Pas mesurable', tone: 'bg-muted text-muted-foreground' };
  if (c.effect >= 1.3) return { label: `Relancée ${times(c.effect)}`, tone: 'bg-phase-2-soft text-phase-2-ink' };
  if (c.effect >= 0.8) return { label: 'Sans effet net', tone: 'bg-muted text-muted-foreground' };
  return { label: 'Pas d’effet visible', tone: 'bg-muted text-muted-foreground' };
}

const KINDS = [
  { key: 'tous', label: 'Tout' },
  { key: 'titre', label: 'Titres' },
  { key: 'miniature', label: 'Miniatures' },
] as const;

export default async function ChangesPage({ searchParams }: { searchParams: Promise<{ type?: string; tri?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const db = createServiceClient();
  const { nicheIds, scopeLabel } = await resolveScope(db, user.id);
  const kind: ChangeKind | null = sp.type === 'titre' ? 'title_change' : sp.type === 'miniature' ? 'thumbnail_change' : null;
  const sort = sp.tri === 'recent' ? 'recent' : 'effet';

  const all = await getChanges(db, { nicheIds, kind, days: 90 });
  const measured = all.filter((c) => c.effect !== null);
  const relaunched = measured.filter((c) => (c.effect ?? 0) >= 1.3);
  const rows = sort === 'effet' ? [...all].sort((a, b) => (b.effect ?? -1) - (a.effect ?? -1)) : all;
  const href = (k: string, t = sort) => `/activity/changes?${new URLSearchParams({ ...(k !== 'tous' ? { type: k } : {}), ...(t !== 'effet' ? { tri: t } : {}) })}`;
  const currentKind = sp.type === 'titre' || sp.type === 'miniature' ? sp.type : 'tous';

  return (
    <div className="flex flex-col gap-6 px-4 pb-12 pt-5 md:px-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">
          Titres et miniatures modifiés{scopeLabel ? ` · ${scopeLabel}` : ''}
        </h1>
        <p className="max-w-[780px] text-[15px] leading-relaxed text-muted-foreground">
          Les 90 derniers jours dans tes thématiques. Pour chaque changement, TubLyTI compare le rythme de vues (vues par jour) de la semaine d’avant au rythme depuis.
          Une vidéo ralentit normalement en vieillissant : quand le rythme <strong className="font-medium text-foreground">remonte</strong> après un changement, le nouveau titre ou la nouvelle miniature marche mieux. Ce sont des tests réels, gratuits à étudier.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:max-w-xl">
        <div className="rounded-2xl bg-card px-4 py-3">
          <dt className="text-[12px] text-muted-foreground">Changements repérés</dt>
          <dd className="text-[22px] font-semibold tabular-nums">{nf.format(all.length)}</dd>
        </div>
        <div className="rounded-2xl bg-card px-4 py-3">
          <dt className="text-[12px] text-muted-foreground">Mesurables</dt>
          <dd className="text-[22px] font-semibold tabular-nums">{nf.format(measured.length)}</dd>
        </div>
        <div className="rounded-2xl bg-card px-4 py-3">
          <dt className="text-[12px] text-muted-foreground">Ont relancé la vidéo</dt>
          <dd className="text-[22px] font-semibold tabular-nums">{measured.length ? `${Math.round((relaunched.length / measured.length) * 100)} %` : '—'}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Type de changement" className="well inline-flex gap-0.5 rounded-[12px] bg-muted p-[3px]">
          {KINDS.map((k) => (
            <Link
              key={k.key}
              href={href(k.key)}
              scroll={false}
              aria-current={currentKind === k.key ? 'true' : undefined}
              className={`flex h-8 items-center rounded-[9px] px-3 text-[13px] ${currentKind === k.key ? 'elev-1 bg-card font-semibold' : 'font-medium text-muted-foreground hover:text-foreground'}`}
            >
              {k.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Tri" className="well inline-flex gap-0.5 rounded-[12px] bg-muted p-[3px]">
          {[
            { key: 'effet', label: 'Ce qui a le mieux marché' },
            { key: 'recent', label: 'Les plus récents' },
          ].map((t) => (
            <Link
              key={t.key}
              href={href(currentKind, t.key)}
              scroll={false}
              aria-current={sort === t.key ? 'true' : undefined}
              className={`flex h-8 items-center rounded-[9px] px-3 text-[13px] ${sort === t.key ? 'elev-1 bg-card font-semibold' : 'font-medium text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <p className="text-[15px] font-medium">Aucun changement repéré pour l’instant.</p>
          <p className="max-w-md text-sm text-muted-foreground">Les titres sont surveillés à chaque relevé de vues ; les miniatures chaque nuit pour les vidéos des 45 derniers jours. Les premiers changements apparaîtront après quelques nuits.</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-card">
          {rows.map((c) => {
            const v = verdict(c);
            return (
              <li key={c.id} className="border-b border-muted last:border-b-0">
                <div className="flex flex-col gap-3 px-4 py-4 md:flex-row md:px-5">
                  <div className="flex shrink-0 items-center gap-2">
                    {c.kind === 'thumbnail_change' && c.oldValue?.startsWith('http') ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.oldValue} alt="Ancienne miniature" loading="lazy" className="aspect-video w-[120px] rounded-[10px] object-cover opacity-75" />
                        <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.newValue ?? `https://i.ytimg.com/vi/${c.videoId}/mqdefault.jpg`} alt="Nouvelle miniature" loading="lazy" className="elev-1 aspect-video w-[120px] rounded-[10px] object-cover" />
                      </>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`https://i.ytimg.com/vi/${c.videoId}/mqdefault.jpg`} alt="" loading="lazy" className="elev-1 aspect-video w-[160px] rounded-[10px] object-cover" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-1.5 py-0.5 text-[12px] font-semibold text-primary-ink">
                        {c.kind === 'title_change' ? <Type className="h-3.5 w-3.5" aria-hidden="true" /> : <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                        {c.kind === 'title_change' ? 'Titre' : 'Miniature'}
                      </span>
                      <span className="font-medium text-foreground">{c.channel}</span>
                      <span>· {compact.format(c.subscribers)} abonnés</span>
                      <span>· {new Date(c.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                    </div>
                    {c.kind === 'title_change' ? (
                      <div className="flex flex-col gap-0.5">
                        <a href={`https://www.youtube.com/watch?v=${c.videoId}`} target="_blank" rel="noreferrer" className="text-[15px] font-semibold leading-snug hover:underline">{c.newValue ?? c.title}</a>
                        {c.oldValue && <p className="text-[13px] leading-snug text-muted-foreground line-through decoration-muted-foreground/50">{c.oldValue}</p>}
                      </div>
                    ) : (
                      <a href={`https://www.youtube.com/watch?v=${c.videoId}`} target="_blank" rel="noreferrer" className="text-[15px] font-semibold leading-snug hover:underline">{c.title}</a>
                    )}
                    <p className="text-[13px] text-muted-foreground">
                      {c.paceBefore !== null ? `${compact.format(c.paceBefore)} vues/jour avant` : 'Rythme d’avant inconnu'}
                      {c.paceAfter !== null ? ` → ${compact.format(c.paceAfter)} vues/jour depuis (${nf.format(c.daysAfter)} j)` : c.daysAfter < 1.5 ? ' · mesure dans 1 à 2 jours' : ''}
                      {c.gainSince ? ` · +${compact.format(c.gainSince)} vues depuis le changement` : ''}
                    </p>
                  </div>
                  <span className={`self-start rounded-full px-2.5 py-1 text-[12px] font-semibold ${v.tone}`}>{v.label}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
