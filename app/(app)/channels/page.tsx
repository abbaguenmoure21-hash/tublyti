import Link from 'next/link';
import { Tv, ExternalLink, ArrowDown } from 'lucide-react';

// Données lues à chaque visite (jamais calculées pendant pnpm build).
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Chaînes analysées' };
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createServiceClient } from '@/lib/supabase/server';
import { isoDaysAgo } from '@/lib/admin/coverage';
import { AddChannelForm } from './_components/add-channel-form';
import { DeleteChannelButton } from './_components/delete-channel-button';

const PAGE_SIZE = 50;

interface Channel {
  id: string;
  title: string | null;
  subscriber_count: number | null;
  last_checked_at: string | null;
  niche_id: string;
  niches: { name: string } | null;
}

interface Niche {
  id: string;
  name: string;
}

type Sort = 'verification' | 'abonnes';

function formatChecked(d: string | null, staleBefore: string) {
  if (!d) return { text: 'Jamais vérifiée', stale: true };
  const text = new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
  return { text, stale: d < staleBefore };
}

function buildHref(params: { q?: string; niche?: string; tri?: Sort; page?: number }) {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.niche) sp.set('niche', params.niche);
  if (params.tri && params.tri !== 'verification') sp.set('tri', params.tri);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  const s = sp.toString();
  return s ? `/channels?${s}` : '/channels';
}

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; niche?: string; tri?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const niche = sp.niche ?? '';
  const tri: Sort = sp.tri === 'abonnes' ? 'abonnes' : 'verification';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const db = createServiceClient();

  let listQ = db
    .from('channels')
    .select('id, title, subscriber_count, last_checked_at, niche_id, niches(name)', { count: 'exact' });
  if (q) listQ = listQ.ilike('title', `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (niche) listQ = listQ.eq('niche_id', niche);
  listQ =
    tri === 'abonnes'
      ? listQ.order('subscriber_count', { ascending: false, nullsFirst: false })
      : listQ.order('last_checked_at', { ascending: true, nullsFirst: true });

  const [channelsResult, nichesResult] = await Promise.all([
    listQ.order('id').range(from, from + PAGE_SIZE - 1),
    db.from('niches').select('id, name').order('name'),
  ]);
  if (channelsResult.error) throw new Error(channelsResult.error.message);
  if (nichesResult.error) throw new Error(nichesResult.error.message);

  const channels = (channelsResult.data ?? []) as unknown as Channel[];
  const niches = (nichesResult.data ?? []) as unknown as Niche[];
  const total = channelsResult.count ?? channels.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || niche);
  const staleBefore = isoDaysAgo(7);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Chaînes analysées</h1>
        <p className="max-w-2xl text-[15px] text-muted-foreground">
          Les chaînes dont TubLyTI collecte les vidéos et les commentaires chaque nuit. Ce catalogue est commun à tous les clients.
        </p>
      </header>

      <AddChannelForm niches={niches} />

      {/* Search + niche filter: plain GET form, state lives in the URL. */}
      <form method="get" action="/channels" className="flex flex-col gap-2 sm:flex-row" role="search">
        <label className="sr-only" htmlFor="ch-q">Rechercher une chaîne</label>
        <Input id="ch-q" name="q" defaultValue={q} placeholder="Rechercher par nom" className="h-10 flex-1" />
        <label className="sr-only" htmlFor="ch-niche">Niche</label>
        <select
          id="ch-niche"
          name="niche"
          defaultValue={niche}
          className="well h-10 rounded-[10px] bg-muted px-3 text-sm text-foreground sm:min-w-44"
        >
          <option value="">Toutes les niches</option>
          {niches.map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
        {tri !== 'verification' && <input type="hidden" name="tri" value={tri} />}
        <Button type="submit" variant="outline" className="h-10">Filtrer</Button>
        {filtered && (
          <Link href={buildHref({ tri })} className="flex h-10 items-center px-2 text-sm font-medium text-primary">Effacer</Link>
        )}
      </form>

      {channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <Tv className="mb-3 size-8 text-muted-foreground" aria-hidden="true" />
          {filtered ? (
            <p className="text-sm text-muted-foreground">Aucune chaîne ne correspond à ce filtre.</p>
          ) : (
            <>
              <p className="text-base font-semibold">Aucune chaîne analysée pour l’instant</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Colle l’adresse d’une chaîne YouTube ci-dessus, choisis sa niche, puis Ajouter. TubLyTI analysera ses vidéos dès la prochaine nuit.
              </p>
            </>
          )}
        </div>
      ) : (
        <section aria-labelledby="ch-list" className="overflow-hidden rounded-xl border border-border bg-card">
          <h2 id="ch-list" className="px-4 py-3 text-sm font-semibold">
            {total.toLocaleString('fr-FR')} chaîne{total > 1 ? 's' : ''} analysée{total > 1 ? 's' : ''}
            {filtered && <span className="font-normal text-muted-foreground"> pour ce filtre</span>}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Chaîne</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Niche</th>
                  <th className="px-4 py-2.5 text-right font-medium" aria-sort={tri === 'abonnes' ? 'descending' : 'none'}>
                    <Link href={buildHref({ q, niche, tri: 'abonnes' })} className="inline-flex items-center gap-1 hover:text-foreground">
                      Abonnés {tri === 'abonnes' && <ArrowDown className="size-3" aria-hidden="true" />}
                    </Link>
                  </th>
                  <th className="px-4 py-2.5 font-medium" aria-sort={tri === 'verification' ? 'ascending' : 'none'}>
                    <Link href={buildHref({ q, niche, tri: 'verification' })} className="inline-flex items-center gap-1 hover:text-foreground">
                      Dernière vérification {tri === 'verification' && <ArrowDown className="size-3" aria-hidden="true" />}
                    </Link>
                  </th>
                  <th className="w-10 px-2 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {channels.map((ch) => {
                  const checked = formatChecked(ch.last_checked_at, staleBefore);
                  return (
                    <tr key={ch.id} className="group border-t border-muted hover:bg-muted">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            <AvatarImage src={`https://unavatar.io/youtube/${ch.id}`} alt="" loading="lazy" />
                            <AvatarFallback className="text-xs">{(ch.title ?? ch.id).substring(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className="flex min-w-0 flex-col">
                            <Link
                              href={`https://youtube.com/channel/${ch.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 font-medium hover:text-primary"
                            >
                              <span className="block max-w-[250px] truncate">{ch.title ?? ch.id}</span>
                              <ExternalLink className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                            </Link>
                            <span className="text-xs text-muted-foreground sm:hidden">{ch.niches?.name ?? '—'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{ch.niches?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {ch.subscriber_count ? ch.subscriber_count.toLocaleString('fr-FR') : '—'}
                      </td>
                      <td className={`px-4 py-2.5 tabular-nums ${checked.stale ? 'font-medium text-phase-1-ink' : 'text-muted-foreground'}`}>
                        {checked.text}
                        {checked.stale && ch.last_checked_at && <span className="sr-only"> (plus de 7 jours)</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <DeleteChannelButton channelId={ch.id} channelTitle={ch.title ?? ch.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
              {page > 1 ? (
                <Link href={buildHref({ q, niche, tri, page: page - 1 })} className="font-medium text-primary">Précédentes</Link>
              ) : <span />}
              <span className="tabular-nums text-muted-foreground">Page {page} sur {pages}</span>
              {page < pages ? (
                <Link href={buildHref({ q, niche, tri, page: page + 1 })} className="font-medium text-primary">Suivantes</Link>
              ) : <span />}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
