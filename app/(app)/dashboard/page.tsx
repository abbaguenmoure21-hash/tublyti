import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';

export const metadata = { title: 'Tableau de bord' };
import { getLatestScoreDate } from '@/lib/scoring/latest-score-date';
import {
  Zap,
  ArrowRight,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MatriceFilters } from './_components/matrice-filters';
import { DashboardShell } from './_components/dashboard-shell';
import { TitlePatternsView } from './_components/title-patterns-view';
import { getFavoriteIds } from '@/lib/actions/collections';

interface TopicRow {
  id: string;
  label: string;
  mgi: number;
  demand: number;
  frustration: number;
  supplyQ: number;
  monetization: number;
  phase: number;
  feasibilityGrade: string | null;
  feasibilityReason: string | null;
  sparkline: number[];
  topQuote: string | null;
  rank: number;
  totalInNiche: number;
}

function parseChannelSize(chsize: string | null): { min: number; max: number } | null {
  if (!chsize) return null;
  const parts = chsize.split('-');
  return {
    min: parseInt(parts[0], 10) || 0,
    max: parts[1] ? parseInt(parts[1], 10) || Infinity : Infinity,
  };
}

async function fetchMatriceData(nicheId: string | null, blueOcean: boolean, phaseFilter: number | null, favFilter: boolean, channelSizeFilter: string | null, feasibleOnly: boolean) {
  const db = createServiceClient();

  // Channels with niches for tabs
  const { data: channels } = await db
    .from('channels')
    .select('id, title, niche_id, niches!inner(id, name)')
    .eq('status', 'active')
    .order('title');

  const { data: niches } = await db
    .from('niches')
    .select('id, name')
    .eq('status', 'active')
    .order('name');

  const scoredAt = await getLatestScoreDate(db);

  let query = db
    .from('topic_scores')
    .select(
      `mgi, demand, frustration, supply_q, monetization, phase, feasibility_grade, feasibility_reason,
       topics!inner(id, label, status, niche_id, niches!inner(id, name, rpm_coefficient))`,
    )
    .eq('scored_at', scoredAt)
    .order('mgi', { ascending: false });

  if (nicheId) {
    query = query.eq('topics.niche_id', nicheId);
  }

  const { data: scores } = await query;

  // Sparklines (30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const topicIds = (scores ?? []).map((s: Record<string, unknown>) => {
    const t = s.topics as unknown as { id: string };
    return t.id;
  });

  let sparklines: Record<string, number[]> = {};
  if (topicIds.length > 0) {
    const { data: trendPoints } = await db
      .from('trend_points')
      .select('topic_id, captured_at, value')
      .in('topic_id', topicIds)
      .eq('source', 'trends')
      .gte('captured_at', thirtyDaysAgo)
      .order('captured_at', { ascending: true });

    const byTopic = new Map<string, number[]>();
    for (const p of trendPoints ?? []) {
      if (!byTopic.has(p.topic_id)) byTopic.set(p.topic_id, []);
      byTopic.get(p.topic_id)!.push(Number(p.value));
    }
    sparklines = Object.fromEntries(byTopic);
  }

  // Top frustration quote per topic
  let topQuotes: Record<string, string> = {};
  if (topicIds.length > 0) {
    const { data: videos } = await db
      .from('videos')
      .select('id, topic_id')
      .in('topic_id', topicIds);

    if (videos && videos.length > 0) {
      const videoToTopic: Record<string, string> = {};
      for (const v of videos) videoToTopic[v.id] = v.topic_id;

      const { data: labels } = await db
        .from('comment_labels')
        .select('comments!inner(text, like_count, video_id)')
        .neq('label', 'none')
        .gte('confidence', 0.7)
        .in('comments.video_id', videos.map((v: Record<string, unknown>) => v.id))
        .order('comments(like_count)', { ascending: false })
        .limit(200);

      const seen = new Set<string>();
      for (const l of labels ?? []) {
        const comment = l.comments as unknown as { text: string; like_count: number; video_id: string };
        const tId = videoToTopic[comment.video_id];
        if (tId && !seen.has(tId)) {
          seen.add(tId);
          topQuotes[tId] = comment.text.length > 120
            ? comment.text.slice(0, 120) + '…'
            : comment.text;
        }
      }
    }
  }

  let topics: TopicRow[] = (scores ?? []).map((s: Record<string, unknown>, idx: number) => {
    const topic = s.topics as unknown as {
      id: string;
      label: string;
      status: string;
      niche_id: string;
      niches: { id: string; name: string; rpm_coefficient: number };
    };
    return {
      id: topic.id,
      label: topic.label,
      mgi: Number(s.mgi),
      demand: Number(s.demand),
      frustration: Number(s.frustration),
      supplyQ: Number(s.supply_q),
      monetization: Number(s.monetization),
      phase: s.phase as number,
      feasibilityGrade: (s.feasibility_grade as string) ?? null,
      feasibilityReason: (s.feasibility_reason as string) ?? null,
      sparkline: sparklines[topic.id] ?? [],
      topQuote: topQuotes[topic.id] ?? null,
      rank: idx + 1,
      totalInNiche: 0,
    };
  });

  // Apply filters
  if (blueOcean) {
    topics = topics.filter((t) => t.demand >= 60 && t.supplyQ <= 3);
  }
  if (phaseFilter !== null && phaseFilter >= 0) {
    topics = topics.filter((t) => t.phase === phaseFilter);
  }
  if (favFilter) {
    const { data: favIds } = await getFavoriteIds('topic');
    const favSet = new Set(favIds);
    topics = topics.filter((t) => favSet.has(t.id));
  }
  if (feasibleOnly) {
    topics = topics.filter((t) => t.feasibilityGrade === 'A' || t.feasibilityGrade === 'B');
  }

  // Channel size filter: keep topics where at least one video comes from a channel of the right size
  const sizeRange = parseChannelSize(channelSizeFilter);
  if (sizeRange && topicIds.length > 0) {
    const { data: videosWithChannels } = await db
      .from('videos')
      .select('topic_id, channels!inner(subscriber_count)')
      .in('topic_id', topicIds);

    const topicsWithMatchingChannel = new Set<string>();
    for (const v of videosWithChannels ?? []) {
      const ch = v.channels as unknown as { subscriber_count: number | null };
      const subs = ch?.subscriber_count ?? 0;
      if (subs >= sizeRange.min && subs < sizeRange.max) {
        topicsWithMatchingChannel.add(v.topic_id as string);
      }
    }
    topics = topics.filter((t) => topicsWithMatchingChannel.has(t.id));
  }

  // Set totalInNiche
  topics.forEach((t, i) => {
    t.rank = i + 1;
    t.totalInNiche = topics.length;
  });

  // Niche tabs for filtering
  const channelTabs = (niches ?? []).map((n: Record<string, unknown>) => ({
    id: n.id as string,
    title: n.name as string,
    nicheId: n.id as string,
  }));

  // Title patterns
  let patternsQuery = db
    .from('title_patterns')
    .select('id, niche_id, formula, description, examples, frequency, emotional_triggers, avg_length, niches!inner(name)')
    .order('frequency', { ascending: false });

  if (nicheId) {
    patternsQuery = patternsQuery.eq('niche_id', nicheId);
  }

  const { data: patternsRaw } = await patternsQuery;

  const titlePatterns = (patternsRaw ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    formula: p.formula as string,
    description: p.description as string,
    examples: (p.examples as string[]) ?? [],
    frequency: Number(p.frequency),
    emotionalTriggers: (p.emotional_triggers as string[]) ?? [],
    avgLength: p.avg_length != null ? Number(p.avg_length) : null,
    nicheName: (p.niches as unknown as { name: string }).name,
  }));

  return { topics, channelTabs, scoredAt, titlePatterns };
}

function ChecklistItem({ done, label, href }: { done: boolean; label: string; href?: string }) {
  const content = (
    <div
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        href ? 'hover:bg-muted/50 cursor-pointer' : ''
      }`}
    >
      {done ? (
        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
      ) : (
        <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />
      )}
      <span className={done ? 'text-muted-foreground line-through' : 'text-foreground'}>
        {label}
      </span>
      {href && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground ml-auto shrink-0" />}
    </div>
  );
  if (href) return <Link href={href}>{content}</Link>;
  return content;
}

export default async function MatricePage({
  searchParams,
}: {
  searchParams: Promise<{ niche?: string; ocean?: string; phase?: string; fav?: string; chsize?: string; feasible?: string }>;
}) {
  const params = await searchParams;
  const nicheId = params.niche || null;
  const blueOcean = params.ocean === '1' || params.ocean === 'true';
  const phaseFilter = params.phase ? parseInt(params.phase, 10) : null;
  const favFilter = params.fav === '1' || params.fav === 'true';
  const channelSizeFilter = params.chsize || null;
  const feasibleOnly = params.feasible === '1' || params.feasible === 'true';

  const { topics, channelTabs, scoredAt, titlePatterns } = await fetchMatriceData(nicheId, blueOcean, phaseFilter, favFilter, channelSizeFilter, feasibleOnly);

  const scoredDate = new Date(scoredAt + 'T00:00:00');
  const formattedDate = scoredDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const formattedTime = scoredDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // Find selected channel name for breadcrumb
  const selectedChannel = nicheId
    ? channelTabs.find((ch: { nicheId: string }) => ch.nicheId === nicheId)
    : null;

  // Find top Phase 2 opportunity for Hero card
  const heroTopic = topics.find((t) => t.phase === 2) ?? topics[0] ?? null;

  if (topics.length === 0 && !nicheId && !blueOcean && phaseFilter === null) {
    // Empty state for brand-new users
    return (
      <div className="flex-1 flex flex-col">
        <header className="h-[56px] shrink-0 flex items-center gap-3 px-8 border-b border-[--glass-border] bg-[--bg-surface-1] backdrop-blur-xl text-[14px] text-muted-foreground">
          <span>Matrice</span>
        </header>
        <div className="flex-1 p-8 space-y-6 max-w-3xl mx-auto">
          <div className="bento-card text-center !py-12">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-primary-foreground mx-auto mb-4 shadow-[0_2px_12px_rgba(10,132,255,0.3)]">
              <Zap className="w-7 h-7" />
            </div>
            <h2 className="text-title-2 mb-2">Bienvenue sur TubLyTI</h2>
            <p className="text-muted-foreground max-w-lg mx-auto text-body">
              TubLyTI détecte les opportunités YouTube avant tout le monde en mesurant le
              déséquilibre entre la demande des spectateurs et l&apos;offre de vidéos existantes.
            </p>
          </div>
          <div className="bento-card">
            <h3 className="text-headline mb-4">Pour commencer</h3>
            <div className="space-y-1">
              <ChecklistItem done={false} label="Ajouter au moins 3 chaînes YouTube" href="/channels" />
              <ChecklistItem done={false} label="Attendre la première collecte (ou lancer dans Admin > Jobs)" href="/admin/jobs" />
              <ChecklistItem done={false} label="Valider les sujets proposés" href="/topics/review" />
              <ChecklistItem done={false} label="Explorer la matrice d'opportunités" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 relative">
      {/* Background gradients multi-niveaux */}
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-x-clip">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/15 dark:bg-blue-600/15 blur-[100px]" />
        <div className="absolute top-[20%] -right-[10%] w-[40%] h-[60%] rounded-full bg-purple-400/15 dark:bg-purple-600/15 blur-[120px]" />
        <div className="absolute -bottom-[20%] left-[20%] w-[60%] h-[50%] rounded-full bg-cyan-400/15 dark:bg-cyan-600/15 blur-[100px]" />
      </div>

      {/* Translucent breadcrumb header */}
      <header className="sticky top-0 z-20 h-[56px] shrink-0 flex items-center gap-3 px-8 border-b border-[--glass-border] bg-background/80 backdrop-blur-xl text-[13px] text-muted-foreground">
        <span className="font-medium">Matrice</span>
        {selectedChannel && (
          <>
            <span className="text-[--glass-border]">/</span>
            <span className="text-foreground font-semibold">{selectedChannel.title}</span>
          </>
        )}
        <div className="flex-1" />
        <span className="text-mono-metric tabular-nums text-[12px]">
          Scores du {formattedDate}, {formattedTime}
        </span>
      </header>

      <div className="flex-1 p-6 md:px-12 md:py-10 flex flex-col gap-10 w-full max-w-[1400px] mx-auto">
        <MatriceFilters channels={channelTabs} />

        {/* Hero Card — Apple Today Tab style for top opportunity */}
        {heroTopic && (
          <Link
            href={`/topics/${heroTopic.id}`}
            className="group relative block overflow-hidden rounded-[28px] border border-[--glass-border] hover:border-[--glass-border-highlight] transition-all duration-300 shrink-0"
            style={{ minHeight: 200 }}
          >
            {/* Background gradient based on phase */}
            <div className="absolute inset-0 bg-gradient-to-br from-[--bg-surface-1] via-background to-background" />
            <div
              className="absolute top-0 right-0 w-1/2 h-full opacity-30"
              style={{
                background: heroTopic.phase === 2
                  ? 'radial-gradient(ellipse at top right, #30D158, transparent 70%)'
                  : heroTopic.phase === 0
                  ? 'radial-gradient(ellipse at top right, #5E5CE6, transparent 70%)'
                  : heroTopic.phase === 1
                  ? 'radial-gradient(ellipse at top right, #FF9F0A, transparent 70%)'
                  : 'radial-gradient(ellipse at top right, #FF453A, transparent 70%)',
              }}
            />

            <div className="relative p-8 flex flex-col gap-4">
              {/* Phase badge */}
              <div className="flex items-center gap-3">
                <span className={`
                  inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide
                  border backdrop-blur-md bg-white/[0.04]
                  ${heroTopic.phase === 2 ? 'border-[#30D158]/30 text-[#5EE07E]' :
                    heroTopic.phase === 0 ? 'border-[#5E5CE6]/30 text-[#8886F0]' :
                    heroTopic.phase === 1 ? 'border-[#FF9F0A]/30 text-[#FFB940]' :
                    'border-[#FF453A]/30 text-[#FF7B73]'}
                `}>
                  <span className="relative flex h-2 w-2">
                    {heroTopic.phase === 2 && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#30D158] opacity-75" />
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${
                      heroTopic.phase === 2 ? 'bg-[#30D158]' :
                      heroTopic.phase === 0 ? 'bg-[#5E5CE6]' :
                      heroTopic.phase === 1 ? 'bg-[#FF9F0A]' : 'bg-[#FF453A]'
                    }`} />
                  </span>
                  {heroTopic.phase === 2 ? 'Fenêtre dorée' : heroTopic.phase === 0 ? 'Émergence' : heroTopic.phase === 1 ? 'Viralité courte' : 'Saturé'}
                </span>
                <span className="text-[12px] text-muted-foreground">Opportunité #1</span>
              </div>

              {/* Title */}
              <h2 className="text-title-1 max-w-2xl leading-tight group-hover:text-primary transition-colors">
                {heroTopic.label}
              </h2>

              {/* Metrics row */}
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-display-giant text-mono-metric tabular-nums" style={{
                    fontSize: 36,
                    color: heroTopic.mgi >= 80 ? '#30D158' : heroTopic.mgi >= 60 ? '#0A84FF' : '#FF9F0A',
                  }}>
                    {Math.round(heroTopic.mgi)}
                  </span>
                  <span className="text-[12px] text-muted-foreground font-medium">MGI / 100</span>
                </div>
                <div className="flex items-center gap-4 text-[13px]">
                  <span className="px-2.5 py-1 rounded-lg bg-[--bg-surface-1] border border-[--glass-border]">
                    <span className="text-muted-foreground">Demande: </span>
                    <span className="font-semibold tabular-nums">{Math.round(heroTopic.demand)}e percentile</span>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-[--bg-surface-1] border border-[--glass-border]">
                    <span className="text-muted-foreground">Frustration: </span>
                    <span className="font-semibold tabular-nums">{Math.round(heroTopic.frustration * 100)}%</span>
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-[--bg-surface-1] border border-[--glass-border]">
                    <span className="text-muted-foreground">Offre: </span>
                    <span className="font-semibold tabular-nums">{heroTopic.supplyQ} vidéos</span>
                  </span>
                </div>
              </div>

              {/* Quote if available */}
              {heroTopic.topQuote && (
                <p className="text-[13px] text-muted-foreground max-w-xl italic">
                  « {heroTopic.topQuote} »
                </p>
              )}

              {/* Action hint */}
              <div className="flex items-center gap-1.5 text-primary text-sm font-medium">
                Ouvrir la fiche sujet
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </Link>
        )}

        <DashboardShell topics={topics}>
          {titlePatterns.length > 0 && <TitlePatternsView patterns={titlePatterns} />}
        </DashboardShell>
      </div>
    </div>
  );
}

