import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { Users, ArrowLeft } from 'lucide-react';
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

  const [{ data: candidates }, { data: niches }] = await Promise.all([
    db
      .from('candidate_channels')
      .select('id, title, subscriber_count, median_views, videos_per_month, faceless_probability, faceless_reason, discovered_via, source_topic_id, created_at, topics(label)')
      .eq('status', 'pending')
      .order(
        sortBy === 'faceless' ? 'faceless_probability' : 'median_views',
        { ascending: false, nullsFirst: false },
      )
      .limit(50),
    db
      .from('niches')
      .select('id, name')
      .eq('status', 'active')
      .order('name'),
  ]);

  const nicheList = (niches ?? []) as { id: string; name: string }[];

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="h-[60px] shrink-0 flex items-center gap-3 px-8 border-b border-border bg-card text-[14px] text-muted-foreground">
        <Link href="/channels" className="hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <span>Chaînes</span>
        <span className="text-border">/</span>
        <span className="text-foreground font-medium">Candidates</span>
      </header>

      <div className="flex-1 p-7 flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-semibold tracking-[-0.02em] leading-tight">
              Chaînes candidates
            </h1>
            <p className="text-[15px] text-muted-foreground">
              Chaînes découvertes automatiquement dans les résultats YouTube. Suivez celles qui sont pertinentes pour enrichir vos niches.
            </p>
          </div>

          {/* Sort toggle */}
          <div className="flex p-[3px] gap-0.5 bg-muted rounded-[9px] shrink-0">
            <Link
              href="/channels/candidates?sort=views"
              className={`h-[30px] px-3 rounded-[7px] text-[13px] font-medium transition-colors ${
                sortBy === 'views'
                  ? 'bg-card text-foreground font-semibold shadow-[0_1px_2px_rgba(20,24,34,0.10)]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Par vues
            </Link>
            <Link
              href="/channels/candidates?sort=faceless"
              className={`h-[30px] px-3 rounded-[7px] text-[13px] font-medium transition-colors ${
                sortBy === 'faceless'
                  ? 'bg-card text-foreground font-semibold shadow-[0_1px_2px_rgba(20,24,34,0.10)]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Par probabilité faceless
            </Link>
          </div>
        </div>

        {(candidates ?? []).length > 0 ? (
          <div className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-left text-[13px]">
                    <th className="px-4 py-2.5 font-medium">Chaîne</th>
                    <th className="px-4 py-2.5 font-medium">Abonnés</th>
                    <th className="px-4 py-2.5 font-medium">Médiane vues</th>
                    <th className="px-4 py-2.5 font-medium">Vidéos/mois</th>
                    <th className="px-4 py-2.5 font-medium">Faceless</th>
                    <th className="px-4 py-2.5 font-medium">Sujet source</th>
                    <th className="px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(candidates ?? []).map((c: Record<string, unknown>) => {
                    const topic = c.topics as unknown as { label: string } | null;
                    return (
                      <tr
                        key={c.id as string}
                        className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`https://youtube.com/channel/${c.id}`}
                            target="_blank"
                            className="font-medium text-foreground hover:text-primary transition-colors"
                          >
                            {(c.title as string) || (c.id as string)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {formatNumber(c.subscriber_count as number | null)}
                        </td>
                        <td className="px-4 py-3 tabular-nums font-medium">
                          {formatNumber(c.median_views as number | null)}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {c.videos_per_month != null ? `${c.videos_per_month as number}` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            {facelessBadge(c.faceless_probability as number | null)}
                            {(c.faceless_reason as string | null) ? (
                              <span className="text-[11px] text-muted-foreground/70 max-w-[200px] truncate">
                                {c.faceless_reason as string}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {topic ? (
                            <span className="text-[13px] text-muted-foreground">
                              {topic.label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <CandidateActions
                            candidateId={c.id as string}
                            niches={nicheList}
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
            <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-[15px] font-medium">Aucune chaîne candidate</p>
            <p className="text-sm text-muted-foreground mt-1">
              Les chaînes seront découvertes automatiquement lors de la prochaine collecte,
              à partir des sujets en phase 1 et 2.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
