import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { createServiceClient } from '@/lib/supabase/server';
import { getLatestScoreDate } from '@/lib/scoring/latest-score-date';
import { isSensitiveTopic } from '@/lib/topics/sensitive';
import { getFavoriteIds } from '@/lib/actions/collections';
import { computeFeasibilityForUser, isNoChannelResult } from '@/lib/scoring/feasibility-for-user';
import { getUserSubsByNiche } from '@/lib/scoring/user-subs';
import { TitlePatternsView } from './_components/title-patterns-view';
import { CarteView, type CarteTopic } from './_components/carte-view';

export const metadata: Metadata = { title: 'Carte des sujets' };

type Params = { moment?: string; peu?: string; fav?: string; sujet?: string };

const MOMENTS = [
  { key: 'tous', label: 'Tous' },
  { key: '2', label: 'C’est le moment' },
  { key: '1', label: 'Ça monte' },
  { key: '0', label: 'À surveiller' },
  { key: '3', label: 'Trop tard' },
];

/** Seuils « peu traité » : demande dans le tiers haut de la thématique, offre de qualité sous la moyenne. */
const LOW_SUPPLY_DEMAND = 0.6;
const LOW_SUPPLY_MAX = 1;

function href(params: Params, patch: Partial<Params>): string {
  const next = { ...params, ...patch };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/dashboard?${s}` : '/dashboard';
}

export default async function CartePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const user = await requireUser();
  const db = createServiceClient();
  const { scope, nicheIds, niches } = await resolveScope(db, user.id);
  const ids = nicheIds.length ? nicheIds : ['00000000-0000-0000-0000-000000000000'];
  const scopeLabel = scope ? niches.find((n) => n.id === scope)?.label : null;

  const scoredAt = await getLatestScoreDate(db);
  const { data: scores } = await db
    .from('topic_scores')
    .select('mgi, demand, frustration, supply_q, phase, confidence, feasibility_grade, feasibility_reason, competitor_subs, topics!inner(id, label, status, niche_id)')
    .eq('scored_at', scoredAt)
    .in('topics.status', ['active', 'in_production'])
    .in('topics.niche_id', ids)
    .order('mgi', { ascending: false })
    .limit(600);

  const rows = (scores ?? []) as unknown as {
    mgi: number | null; demand: number | null; frustration: number | null; supply_q: number | null; phase: number | null;
    confidence: string | null; feasibility_grade: string | null; feasibility_reason: string | null;
    competitor_subs: number[] | null;
    topics: { id: string; label: string; niche_id: string };
  }[];

  // Per-user feasibility: load subscriber counts for this user's channels.
  const userSubsByNiche = await getUserSubsByNiche(db, user.id);

  // Nombre de vidéos repérées par sujet (pour les sujets encore sans mesure).
  const topicIds = rows.map((r) => r.topics.id);
  const videoCount = new Map<string, number>();
  if (topicIds.length) {
    const { data: vids } = await db.from('videos').select('topic_id').in('topic_id', topicIds).limit(20000);
    for (const v of (vids ?? []) as { topic_id: string }[]) videoCount.set(v.topic_id, (videoCount.get(v.topic_id) ?? 0) + 1);
  }

  const labelByNiche = new Map(niches.map((n) => [n.id, n.label]));
  let all: CarteTopic[] = rows.map((r) => {
    const demand = Number(r.demand ?? 0);
    const supply = Number(r.supply_q ?? 0);
    const mgi = Number(r.mgi ?? 0);
    const measured = mgi > 0 || demand > 0 || supply > 0;
    return {
      id: r.topics.id,
      label: r.topics.label,
      channel: labelByNiche.get(r.topics.niche_id) ?? '',
      phase: Number(r.phase ?? 0),
      potential: Math.round(mgi),
      demand: Math.round(demand * 100),
      supply: Math.round(supply * 10) / 10,
      frustration: Math.round(Number(r.frustration ?? 0) * 100),
      // Faisabilité calculée par client : ses abonnés vs les concurrents du sujet.
      ...(() => {
        const userSubs = userSubsByNiche.get(r.topics.niche_id) ?? null;
        if (userSubs == null) return { feasibility: null, feasibilityReason: null };
        const f = computeFeasibilityForUser(userSubs, r.competitor_subs);
        if (isNoChannelResult(f)) return { feasibility: null, feasibilityReason: null };
        return { feasibility: f.grade, feasibilityReason: f.reason };
      })(),
      reliable: r.confidence === 'high' || r.confidence === 'medium',
      measured,
      videos: videoCount.get(r.topics.id) ?? 0,
      sensitive: isSensitiveTopic(r.topics.label),
    };
  });

  const counts: Record<string, number> = { tous: all.length };
  for (const t of all) counts[String(t.phase)] = (counts[String(t.phase)] ?? 0) + 1;

  const moment = MOMENTS.some((m) => m.key === params.moment) ? params.moment! : 'tous';
  const lowSupplyOnly = params.peu === '1';
  const favOnly = params.fav === '1';

  if (moment !== 'tous') all = all.filter((t) => String(t.phase) === moment);
  if (lowSupplyOnly) all = all.filter((t) => t.measured && t.demand >= LOW_SUPPLY_DEMAND * 100 && t.supply <= LOW_SUPPLY_MAX);
  if (favOnly) {
    const { data: favIds } = await getFavoriteIds('topic');
    const fav = new Set(favIds);
    all = all.filter((t) => fav.has(t.id));
  }
  // Sujets mesurés d'abord (potentiel décroissant), puis les autres par nombre de vidéos repérées.
  all.sort((a, b) => Number(b.measured) - Number(a.measured) || b.potential - a.potential || b.videos - a.videos);

  // Formules de titres des thématiques affichées
  const { data: patternsRaw } = await db
    .from('title_patterns')
    .select('id, niche_id, formula, description, examples, frequency, emotional_triggers, avg_length, niches!inner(name)')
    .in('niche_id', ids)
    .order('frequency', { ascending: false });
  const titlePatterns = (patternsRaw ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    formula: p.formula as string,
    description: p.description as string,
    examples: (p.examples as string[]) ?? [],
    frequency: Number(p.frequency),
    emotionalTriggers: (p.emotional_triggers as string[]) ?? [],
    avgLength: p.avg_length != null ? Number(p.avg_length) : null,
    nicheName: labelByNiche.get(p.niche_id as string) ?? (p.niches as unknown as { name: string }).name,
  }));

  const date = new Date(`${scoredAt}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const pill = (on: boolean) =>
    `flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors ${
      on ? 'bg-foreground text-background' : 'bg-card text-foreground ring-1 ring-inset ring-border hover:bg-muted'
    }`;

  return (
    <div className="flex flex-col gap-6 px-4 pb-12 pt-5 md:px-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">
          {scopeLabel ? `Carte des sujets · ${scopeLabel}` : 'Carte des sujets'}
        </h1>
        <p className="max-w-[760px] text-[15px] leading-relaxed text-muted-foreground">
          Chaque point est un sujet. Plus il est haut, plus le public le demande. Plus il est à gauche, moins il existe de bonnes vidéos dessus.
          Les meilleures occasions sont en haut à gauche. Mis à jour le {date}.
        </p>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <nav aria-label="Filtrer par moment" className="well inline-flex max-w-full gap-0.5 self-start overflow-x-auto rounded-[12px] bg-muted p-[3px]">
          {MOMENTS.map((m) => {
            const on = m.key === moment;
            return (
              <Link
                key={m.key}
                href={href(params, { moment: m.key === 'tous' ? undefined : m.key, sujet: undefined })}
                scroll={false}
                aria-current={on ? 'true' : undefined}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-3 text-[13px] transition-all ${
                  on ? 'elev-1 bg-card font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground'
                }`}
              >
                {m.label}
                <span className="tabular-nums text-[12px] font-normal text-muted-foreground">{counts[m.key] ?? 0}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex gap-2">
          <Link href={href(params, { peu: lowSupplyOnly ? undefined : '1', sujet: undefined })} scroll={false} aria-pressed={lowSupplyOnly} className={pill(lowSupplyOnly)}>
            Très demandés, peu traités
          </Link>
          <Link href={href(params, { fav: favOnly ? undefined : '1', sujet: undefined })} scroll={false} aria-pressed={favOnly} className={pill(favOnly)}>
            Favoris
          </Link>
        </div>
      </div>

      <CarteView
        topics={all}
        selectedId={params.sujet ?? null}
        lowSupply={{ demand: LOW_SUPPLY_DEMAND * 100, supply: LOW_SUPPLY_MAX }}
        emptyHint={
          lowSupplyOnly
            ? 'Aucun sujet n’est à la fois très demandé et peu traité en ce moment. Regarde ceux qui montent.'
            : favOnly
              ? 'Aucun favori ici. Clique sur l’étoile d’un sujet pour l’ajouter.'
              : 'Aucun sujet pour ce filtre.'
        }
      />

      {titlePatterns.length > 0 && <TitlePatternsView patterns={titlePatterns} />}
    </div>
  );
}
