import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { Users } from 'lucide-react';
import { CandidateActions } from './_components/candidate-actions';

export const metadata = { title: 'Chaînes candidates' };

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
      ? 'bg-success/10 text-success'
      : probability >= 0.4
        ? 'bg-warning/10 text-warning'
        : 'bg-muted text-muted-foreground';

  return (
    <span className={`text-[12px] px-2 py-0.5 rounded-full font-medium ${color}`}>
      {pct}% faceless
    </span>
  );
}

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const params = await searchParams;
  const sortBy = params.sort === 'faceless' ? 'faceless' : 'views';

  const db = createServiceClient();

  const BASE = 'id, title, subscriber_count, median_views, videos_per_month, faceless_probability, faceless_reason, discovered_via, source_topic_id, created_at, topics(label)';
  const pendingQ = (cols: string) =>
    db
      .from('candidate_channels')
      .select(cols)
      .eq('status', 'pending')
      .order(sortBy === 'faceless' ? 'faceless_probability' : 'median_views', { ascending: false, nullsFirst: false })
      .limit(1000);
  const [pendingRes, { data: niches }, decidedRes] = await Promise.all([
    pendingQ(`${BASE}, niche_id, niche_confidence, niche_source`),
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
  // Avant la migration 00024 : pas de niche détectée.
  const candidates = (pendingRes.error ? (await pendingQ(BASE)).data : pendingRes.data) as Record<string, unknown>[] | null;
  const decided = (decidedRes.error ? [] : decidedRes.data ?? []) as { id: string; title: string | null; status: string; auto_reason: string | null; niche_id: string | null; decided_at: string }[];

  const nicheList = (niches ?? []) as { id: string; name: string }[];
  const nicheName = new Map(nicheList.map((n) => [n.id, n.name]));

  return (
    <div className="flex-1 flex flex-col min-h-full relative overflow-x-clip">
      {/* Background gradients multi-niveaux */}
      <div className="absolute inset-0 pointer-events-none -z-10">
      </div>



      <div className="flex w-full flex-1 flex-col gap-6 overflow-x-hidden px-4 py-6 md:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">
                Chaînes candidates
              </h1>
              <span className="bg-secondary text-secondary-foreground text-[12px] font-bold px-2.5 py-0.5 rounded-full">
                {(candidates ?? []).length}
              </span>
            </div>
            <p className="text-[16px] font-medium text-muted-foreground/80">
              Chaque nuit, TubLyTI lit les chaînes découvertes, détecte leur niche à partir de leurs derniers titres, puis les ajoute au catalogue ou les écarte. Quand au moins 3 bonnes chaînes semblables ne ressemblent à aucune niche, une nouvelle niche est créée pour elles. Celles qui restent ici n’ont pas encore été lues.
            </p>
          </div>

          {/* Sort toggle (Segmented Control Apple style) */}
          <div className="flex p-1 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-[11px] shrink-0 w-fit backdrop-blur-xl">
            <Link
              href="/channels/candidates?sort=views"
              className={`flex items-center justify-center px-4 py-1.5 rounded-[7px] text-[13px] font-bold transition-all ${
                sortBy === 'views'
                  ? 'bg-white dark:bg-[#1C1C1E] text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.12)] ring-1 ring-black/5 dark:ring-white/10'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Par vues
            </Link>
            <Link
              href="/channels/candidates?sort=faceless"
              className={`flex items-center justify-center px-4 py-1.5 rounded-[7px] text-[13px] font-bold transition-all ${
                sortBy === 'faceless'
                  ? 'bg-white dark:bg-[#1C1C1E] text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.12)] ring-1 ring-black/5 dark:ring-white/10'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Par probabilité faceless
            </Link>
          </div>
        </div>

        {(candidates ?? []).length > 0 ? (
          <div className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-[0_4px_20px_rgb(0,0,0,0.03)] rounded-[24px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-black/5 dark:bg-black/20 text-muted-foreground text-left text-[12px] font-bold uppercase tracking-wider">
                    <th className="px-5 py-4">Chaîne</th>
                    <th className="px-5 py-4">Abonnés</th>
                    <th className="px-5 py-4">Médiane vues</th>
                    <th className="px-5 py-4">Vidéos/mois</th>
                    <th className="px-5 py-4">Faceless</th>
                    <th className="px-5 py-4">Niche détectée</th>
                    <th className="px-5 py-4">Sujet source</th>
                    <th className="px-5 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(candidates ?? []).map((c) => {
                    const topic = c.topics as unknown as { label: string } | null;
                    return (
                      <tr
                        key={c.id as string}
                        className="border-b border-black/5 dark:border-white/10 last:border-0 hover:bg-white/50 dark:hover:bg-white/5 transition-colors"
                      >
                        <td className="px-5 py-4">
                          <Link
                            href={`https://youtube.com/channel/${c.id}`}
                            target="_blank"
                            className="font-bold text-foreground hover:text-primary transition-colors"
                          >
                            {(c.title as string) || (c.id as string)}
                          </Link>
                        </td>
                        <td className="px-5 py-4 tabular-nums font-bold text-foreground/80">
                          {formatNumber(c.subscriber_count as number | null)}
                        </td>
                        <td className="px-5 py-4 tabular-nums font-bold text-foreground/80">
                          {formatNumber(c.median_views as number | null)}
                        </td>
                        <td className="px-5 py-4 tabular-nums text-muted-foreground font-medium">
                          {c.videos_per_month != null ? `${c.videos_per_month as number}` : '—'}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-1 items-start">
                            {facelessBadge(c.faceless_probability as number | null)}
                            {(c.faceless_reason as string | null) ? (
                              <span className="text-[11px] font-medium text-muted-foreground/70 max-w-[200px] line-clamp-2">
                                {c.faceless_reason as string}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-5 py-4">
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
                            <span className="text-muted-foreground/50">À lire cette nuit</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {topic ? (
                            <span className="text-[13px] font-medium text-muted-foreground">
                              {topic.label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <CandidateActions
                            candidateId={c.id as string}
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
          </div>
        ) : (
          <div className="bg-card border border-border rounded-[10px] p-12 shadow-[0_1px_2px_rgba(20,24,34,0.06)] text-center">
            <Users className="w-8 h-8 text-muted-foreground/60 mx-auto mb-3" />
            <p className="text-[15px] font-medium">Aucune chaîne candidate</p>
            <p className="text-sm text-muted-foreground mt-1">
              Les chaînes seront découvertes automatiquement lors de la prochaine collecte,
              à partir des sujets en phase 1 et 2.
            </p>
          </div>
        )}

        {decided.length > 0 && (
          <section aria-labelledby="decisions-titre" className="flex flex-col gap-3">
            <h2 id="decisions-titre" className="text-[20px] font-semibold tracking-[-0.01em]">Décisions automatiques récentes</h2>
            <ul className="overflow-hidden rounded-2xl bg-card">
              {decided.map((d) => (
                <li key={d.id} className="flex items-start gap-3 border-b border-muted px-4 py-3 last:border-b-0">
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${
                      d.status === 'rejected' ? 'bg-muted text-muted-foreground' : d.status === 'unmatched' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
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
    </div>
  );
}
