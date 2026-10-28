import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { Users } from 'lucide-react';
import { CandidateActions } from './_components/candidate-actions';

export const metadata = { title: 'Chaînes à valider' };

const PAGE_SIZE = 50;

function formatNumber(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')} k`;
  return String(n);
}

function facelessBadge(probability: number | null) {
  if (probability == null) return null;
  const pct = Math.round(probability * 100);
  const color =
    probability >= 0.7
      ? 'bg-phase-2-soft text-phase-2-ink'
      : probability >= 0.4
        ? 'bg-phase-1-soft text-phase-1-ink'
        : 'bg-muted text-muted-foreground';

  return (
    <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${color}`}>
      {pct} % sans visage
    </span>
  );
}

function href(params: { sort?: string; niche?: string; page?: number }) {
  const sp = new URLSearchParams();
  if (params.sort === 'faceless') sp.set('sort', 'faceless');
  if (params.niche) sp.set('niche', params.niche);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  const s = sp.toString();
  return s ? `/channels/candidates?${s}` : '/channels/candidates';
}

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; niche?: string; page?: string }>;
}) {
  const params = await searchParams;
  const sortBy = params.sort === 'faceless' ? 'faceless' : 'views';
  const niche = params.niche ?? '';
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const db = createServiceClient();

  const BASE = 'id, title, subscriber_count, median_views, videos_per_month, faceless_probability, faceless_reason, discovered_via, source_topic_id, created_at, topics(label)';
  const pendingQ = (cols: string, withNiche: boolean) => {
    let q = db
      .from('candidate_channels')
      .select(cols, { count: 'exact' })
      .eq('status', 'pending');
    if (withNiche && niche) q = q.eq('niche_id', niche);
    return q
      .order(sortBy === 'faceless' ? 'faceless_probability' : 'median_views', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
  };
  const [pendingRes, nichesRes, decidedRes] = await Promise.all([
    pendingQ(`${BASE}, niche_id, niche_confidence, niche_source`, true),
    db
      .from('niches')
      .select('id, name')
      .eq('status', 'active')
      .order('name'),
    db
      .from('candidate_channels')
      .select('id, title, status, auto_reason, niche_id, decided_at')
      .not('decided_at', 'is', null)
      .order('decided_at', { ascending: false })
      .limit(40),
  ]);
  if (nichesRes.error) throw new Error(nichesRes.error.message);
  // Avant la migration 00024 : pas de niche détectée (ni filtre par niche).
  const pending = pendingRes.error ? await pendingQ(BASE, false) : pendingRes;
  if (pending.error) throw new Error(pending.error.message);
  const candidates = (pending.data ?? []) as unknown as Record<string, unknown>[];
  const total = pending.count ?? candidates.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const decided = (decidedRes.error ? [] : decidedRes.data ?? []) as { id: string; title: string | null; status: string; auto_reason: string | null; niche_id: string | null; decided_at: string }[];

  const nicheList = (nichesRes.data ?? []) as { id: string; name: string }[];
  const nicheName = new Map(nicheList.map((n) => [n.id, n.name]));

  const segment = (active: boolean) =>
    `flex items-center justify-center rounded-[9px] px-3 py-1.5 text-[13px] font-medium ${active ? 'elev-1 bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'}`;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Chaînes à valider</h1>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] font-medium tabular-nums text-muted-foreground">
            {total.toLocaleString('fr-FR')}
          </span>
        </div>
        <p className="max-w-3xl text-[15px] text-muted-foreground">
          Chaque nuit, TubLyTI lit les chaînes découvertes, détecte leur niche à partir de leurs derniers titres, puis les ajoute au catalogue ou les écarte. Quand au moins 3 bonnes chaînes semblables ne ressemblent à aucune niche, une nouvelle niche est créée pour elles. Celles qui restent ici n’ont pas encore été lues.
        </p>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Trier" className="well flex w-fit gap-0.5 rounded-[12px] bg-muted p-[3px]">
          <Link href={href({ sort: 'views', niche })} aria-current={sortBy === 'views' ? 'true' : undefined} className={segment(sortBy === 'views')}>
            Par vues
          </Link>
          <Link href={href({ sort: 'faceless', niche })} aria-current={sortBy === 'faceless' ? 'true' : undefined} className={segment(sortBy === 'faceless')}>
            Sans visage d’abord
          </Link>
        </nav>
        <form method="get" action="/channels/candidates" className="flex gap-2">
          {sortBy === 'faceless' && <input type="hidden" name="sort" value="faceless" />}
          <label className="sr-only" htmlFor="cand-niche">Niche détectée</label>
          <select id="cand-niche" name="niche" defaultValue={niche} className="well h-9 rounded-[10px] bg-muted px-3 text-sm text-foreground">
            <option value="">Toutes les niches</option>
            {nicheList.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-[10px] border border-border bg-card px-3 text-sm font-medium hover:bg-muted">Filtrer</button>
        </form>
      </div>

      {candidates.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Chaîne</th>
                  <th className="px-4 py-2.5 text-right font-medium">Abonnés</th>
                  <th className="px-4 py-2.5 text-right font-medium">Vues habituelles</th>
                  <th className="px-4 py-2.5 text-right font-medium">Vidéos par mois</th>
                  <th className="px-4 py-2.5 font-medium">Sans visage</th>
                  <th className="px-4 py-2.5 font-medium">Niche détectée</th>
                  <th className="px-4 py-2.5 font-medium">Sujet d’origine</th>
                  <th className="px-4 py-2.5 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const topic = c.topics as unknown as { label: string } | null;
                  const title = (c.title as string) || (c.id as string);
                  return (
                    <tr key={c.id as string} className="border-t border-muted align-top hover:bg-muted">
                      <td className="px-4 py-3">
                        <Link
                          href={`https://youtube.com/channel/${c.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:text-primary"
                        >
                          {title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(c.subscriber_count as number | null)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(c.median_views as number | null)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {c.videos_per_month != null ? `${c.videos_per_month as number}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          {facelessBadge(c.faceless_probability as number | null)}
                          {(c.faceless_reason as string | null) ? (
                            <span className="line-clamp-2 max-w-[200px] text-[11px] text-muted-foreground">{c.faceless_reason as string}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {c.niche_id ? (
                          <span className="flex flex-col">
                            <span className="text-[13px] font-medium">{nicheName.get(c.niche_id as string) ?? '—'}</span>
                            {c.niche_confidence != null && (
                              <span className="text-[11px] text-muted-foreground">
                                {c.niche_source === 'manual' ? 'choisie à la main' : `${Math.round((c.niche_confidence as number) * 100)} % de ressemblance`}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">À lire cette nuit</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-muted-foreground">{topic ? topic.label : '—'}</td>
                      <td className="px-4 py-3">
                        <CandidateActions
                          candidateId={c.id as string}
                          candidateTitle={title}
                          niches={nicheList}
                          defaultNiche={(c.niche_id as string | null) ?? undefined}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
              {page > 1 ? <Link href={href({ sort: sortBy, niche, page: page - 1 })} className="font-medium text-primary">Précédentes</Link> : <span />}
              <span className="tabular-nums text-muted-foreground">Page {page} sur {pages}</span>
              {page < pages ? <Link href={href({ sort: sortBy, niche, page: page + 1 })} className="font-medium text-primary">Suivantes</Link> : <span />}
            </nav>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <Users className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-[15px] font-medium">{niche ? 'Aucune chaîne à valider dans cette niche' : 'Aucune chaîne à valider'}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Les chaînes sont découvertes automatiquement lors de la collecte de nuit, à partir des sujets en phase 1 et 2.
          </p>
        </div>
      )}

      {decided.length > 0 && (
        <section aria-labelledby="decisions-titre" className="flex flex-col gap-3">
          <h2 id="decisions-titre" className="text-lg font-semibold">Décisions automatiques récentes</h2>
          <ul className="overflow-hidden rounded-xl border border-border bg-card">
            {decided.map((d) => (
              <li key={d.id} className="flex items-start gap-3 border-b border-muted px-4 py-3 last:border-b-0">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${
                    d.status === 'rejected' ? 'bg-muted text-muted-foreground' : d.status === 'unmatched' ? 'bg-phase-1-soft text-phase-1-ink' : 'bg-phase-2-soft text-phase-2-ink'
                  }`}
                >
                  {d.status === 'rejected' ? 'Écartée' : d.status === 'unmatched' ? 'Hors niche' : 'Ajoutée'}
                </span>
                <div className="flex min-w-0 flex-col">
                  <a href={`https://youtube.com/channel/${d.id}`} target="_blank" rel="noreferrer" className="truncate text-sm font-medium hover:underline">
                    {d.title ?? d.id}
                  </a>
                  <span className="text-xs leading-snug text-muted-foreground">
                    {d.niche_id && d.status !== 'unmatched' ? `${nicheName.get(d.niche_id) ?? ''} · ` : ''}
                    {d.auto_reason}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
