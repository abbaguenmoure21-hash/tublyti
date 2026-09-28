import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { getLatestScoreDate } from '@/lib/scoring/latest-score-date';
import {
  Zap,
  ArrowRight,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MatriceFilters } from './_components/matrice-filters';
import { MatriceView } from './_components/matrice-view';
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
      `mgi, demand, frustration, supply_q, monetization, phase, feasibility_grade,
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

  // Unique channels for tabs (deduplicated by niche)
  const seenNiches = new Set<string>();
  const channelTabs = (channels ?? [])
    .filter((ch: Record<string, unknown>) => {
      const niche = ch.niches as unknown as { id: string };
      if (seenNiches.has(niche.id)) return false;
      seenNiches.add(niche.id);
      return true;
    })
    .map((ch: Record<string, unknown>) => ({
      id: ch.id as string,
      title: ch.title as string,
      nicheId: (ch.niches as unknown as { id: string }).id,
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

  if (topics.length === 0 && !nicheId && !blueOcean && phaseFilter === null) {
    // Empty state for brand-new users
    return (
      <div className="flex-1 flex flex-col">
        <header className="h-[60px] shrink-0 flex items-center gap-3 px-8 border-b border-border bg-card text-[14px] text-muted-foreground">
          <span>Matrice</span>
        </header>
        <div className="flex-1 p-7 space-y-6 max-w-3xl mx-auto">
          <Card className="border-primary/20">
            <CardContent className="py-10 text-center">
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-primary-foreground mx-auto mb-4">
                <Zap className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold mb-2">Bienvenue sur TubLyTI</h2>
              <p className="text-muted-foreground max-w-lg mx-auto">
                TubLyTI détecte les opportunités YouTube avant tout le monde en mesurant le
                déséquilibre entre la demande des spectateurs et l&apos;offre de vidéos existantes.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pour commencer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <ChecklistItem done={false} label="Ajouter au moins 3 chaînes YouTube" href="/channels" />
              <ChecklistItem done={false} label="Attendre la première collecte (ou lancer dans Admin > Jobs)" href="/admin/jobs" />
              <ChecklistItem done={false} label="Valider les sujets proposés" href="/topics/review" />
              <ChecklistItem done={false} label="Explorer la matrice d'opportunités" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Breadcrumb header */}
      <header className="h-[60px] shrink-0 flex items-center gap-3 px-8 border-b border-border bg-card text-[14px] text-muted-foreground">
        <span>Matrice</span>
        {selectedChannel && (
          <>
            <span className="text-border">/</span>
            <span className="text-foreground font-medium">{selectedChannel.title}</span>
          </>
        )}
        <div className="flex-1" />
        <span>Scores du {formattedDate}, {formattedTime}</span>
      </header>

      <div className="flex-1 p-7 flex flex-col gap-5">
        <MatriceFilters channels={channelTabs} />
        <MatriceView topics={topics} />
        {titlePatterns.length > 0 && <TitlePatternsView patterns={titlePatterns} />}
      </div>
    </div>
  );
}
