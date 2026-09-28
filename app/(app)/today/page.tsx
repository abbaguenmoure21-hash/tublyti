import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';
import { getLatestScoreDate } from '@/lib/scoring/latest-score-date';
import { PhaseBadge, MgiScore, PHASE_LABELS } from '@/components/tublyti';
import { FeasibilityBadge } from '@/components/tublyti/feasibility-badge';
import { gradeWeight, type FeasibilityGrade } from '@/lib/scoring/feasibility';
import { Search, ArrowRight, TrendingDown, Sparkles, Upload, Type, Image, TrendingUp } from 'lucide-react';
import { MarkProductionButton } from './_components/mark-production-button';
import { LastVisitTracker } from './_components/last-visit-tracker';

export const metadata = { title: 'Aujourd\u2019hui' };

interface TopicForCard {
  id: string;
  label: string;
  phase: number;
  mgi: number;
  feasibilityGrade: FeasibilityGrade | null;
  quote: string | null;
  quoteLikes: string | null;
}

interface ChannelData {
  id: string;
  title: string;
  nicheName: string;
  nicheId: string;
  topics: TopicForCard[];
}

interface ProductionTopic {
  id: string;
  label: string;
  nicheName: string;
  ageDays: number;
}

interface NotableEvent {
  id: string;
  eventType: string;
  videoTitle: string;
  channelTitle: string;
  videoId: string;
  meta: Record<string, unknown> | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

interface RecentChange {
  type: 'phase_change' | 'new_topics' | 'burndown';
  label: string;
  topicId?: string;
  fromPhase?: number;
  toPhase?: number;
  linkHref?: string;
  linkLabel?: string;
}

function formatLikes(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')} k`;
  return String(n);
}

export default async function TodayPage() {
  const db = createServiceClient();
  const cookieStore = await cookies();
  const lastVisit = cookieStore.get('tublyti-last-visit')?.value ?? null;
  const lastVisitDate = lastVisit ? new Date(lastVisit) : null;

  const [scoredAt, jobsResult, channelsResult] = await Promise.all([
    getLatestScoreDate(db),
    db
      .from('jobs')
      .select('kind, started_at, finished_at, error')
      .order('started_at', { ascending: false })
      .limit(15),
    db
      .from('channels')
      .select('id, title, niche_id, niches(id, name)')
      .order('title'),
  ]);

  // Determine cron status
  const latestByKind = new Map<string, { finished_at: string | null; error: string | null; started_at: string }>();
  for (const job of jobsResult.data ?? []) {
    if (!latestByKind.has(job.kind)) latestByKind.set(job.kind, job);
  }
  const allJobsOk = latestByKind.size >= 3 &&
    [...latestByKind.values()].every((j) => j.finished_at && !j.error);
  const scoreDate = new Date(scoredAt + 'T00:00:00');
  const scoreDateFormatted = scoreDate.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
  const scoreJob = latestByKind.get('score');
  const scoreTime = scoreJob?.finished_at
    ? new Date(scoreJob.finished_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '';

  // Build unique niches from channels
  const channels = (channelsResult.data ?? []) as unknown as {
    id: string;
    title: string;
    niche_id: string;
    niches: { id: string; name: string } | null;
  }[];

  const nicheMap = new Map<string, { id: string; name: string; channelId: string; channelTitle: string }>();
  for (const ch of channels) {
    if (ch.niches && !nicheMap.has(ch.niche_id)) {
      nicheMap.set(ch.niche_id, {
        id: ch.niches.id,
        name: ch.niches.name,
        channelId: ch.id,
        channelTitle: ch.title ?? ch.id,
      });
    }
  }

  // Get all topic scores for latest date
  const { data: allScores } = await db
    .from('topic_scores')
    .select(
      `mgi, demand, frustration, supply_q, monetization, phase, feasibility_grade,
       topics!inner(id, label, status, niche_id)`,
    )
    .eq('scored_at', scoredAt)
    .in('topics.status', ['active', 'in_production'])
    .order('mgi', { ascending: false });

  // Group scores by niche, pick top 3 (phase 2 first, then MGI × feasibility)
  const scoresByNiche = new Map<string, { topicId: string; label: string; mgi: number; phase: number; feasibilityGrade: FeasibilityGrade | null }[]>();
  for (const s of allScores ?? []) {
    const topic = s.topics as unknown as { id: string; label: string; status: string; niche_id: string };
    const nicheId = topic.niche_id;
    if (!scoresByNiche.has(nicheId)) scoresByNiche.set(nicheId, []);
    scoresByNiche.get(nicheId)!.push({
      topicId: topic.id,
      label: topic.label,
      mgi: Number(s.mgi),
      phase: s.phase as number,
      feasibilityGrade: (s.feasibility_grade as FeasibilityGrade) ?? null,
    });
  }

  // Sort: phase 2 first, then by MGI × feasibility weight desc
  for (const [, topics] of scoresByNiche) {
    topics.sort((a, b) => {
      if (a.phase === 2 && b.phase !== 2) return -1;
      if (b.phase === 2 && a.phase !== 2) return 1;
      const aScore = a.mgi * gradeWeight(a.feasibilityGrade ?? 'C');
      const bScore = b.mgi * gradeWeight(b.feasibilityGrade ?? 'C');
      return bScore - aScore;
    });
  }

  // Collect all top topic IDs for frustration queries
  const topTopicIds: string[] = [];
  for (const [, topics] of scoresByNiche) {
    for (const t of topics.slice(0, 3)) {
      topTopicIds.push(t.topicId);
    }
  }

  // Get top frustration per topic (batch)
  let frustrationByTopic: Record<string, { text: string; likes: number }> = {};
  if (topTopicIds.length > 0) {
    const { data: videos } = await db
      .from('videos')
      .select('id, topic_id')
      .in('topic_id', topTopicIds);

    const videoToTopic: Record<string, string> = {};
    const videoIds: string[] = [];
    for (const v of videos ?? []) {
      videoToTopic[v.id] = v.topic_id;
      videoIds.push(v.id);
    }

    if (videoIds.length > 0) {
      const { data: comments } = await db
        .from('comments')
        .select('id, text, like_count, video_id')
        .in('video_id', videoIds)
        .order('like_count', { ascending: false })
        .limit(200);

      const commentIds = (comments ?? []).map((c: { id: string }) => c.id);
      if (commentIds.length > 0) {
        const { data: labels } = await db
          .from('comment_labels')
          .select('comment_id, label')
          .in('comment_id', commentIds)
          .neq('label', 'none')
          .gte('confidence', 0.7);

        const labelSet = new Set((labels ?? []).map((l: { comment_id: string }) => l.comment_id));
        for (const c of comments ?? []) {
          if (!labelSet.has(c.id)) continue;
          const topicId = videoToTopic[c.video_id];
          if (!topicId || frustrationByTopic[topicId]) continue;
          frustrationByTopic[topicId] = { text: c.text, likes: c.like_count };
        }
      }
    }
  }

  // Build channel data
  const channelDataList: ChannelData[] = [];
  for (const [nicheId, niche] of nicheMap) {
    const topics = (scoresByNiche.get(nicheId) ?? []).slice(0, 3);
    if (topics.length === 0) continue;
    channelDataList.push({
      id: niche.channelId,
      title: niche.channelTitle,
      nicheName: niche.name,
      nicheId: niche.id,
      topics: topics.map((t) => {
        const frust = frustrationByTopic[t.topicId];
        return {
          id: t.topicId,
          label: t.label,
          phase: t.phase,
          mgi: t.mgi,
          feasibilityGrade: t.feasibilityGrade,
          quote: frust ? frust.text.slice(0, 120) : null,
          quoteLikes: frust ? formatLikes(frust.likes) : null,
        };
      }),
    });
  }

  // KPI stats
  const allTopicScores = allScores ?? [];
  const idealCount = allTopicScores.filter((s: Record<string, unknown>) => s.phase === 2).length;
  const totalTracked = allTopicScores.length;

  // Topics in production (with age)
  const { data: prodTopics } = await db
    .from('topics')
    .select('id, label, niche_id, niches(name), created_at')
    .eq('status', 'in_production');

  const productionList: ProductionTopic[] = (prodTopics ?? []).map(
    (t: Record<string, unknown>) => {
      const ageDays = Math.max(1, Math.floor(
        (Date.now() - new Date(t.created_at as string).getTime()) / 86_400_000,
      ));
      return {
        id: t.id as string,
        label: t.label as string,
        nicheName: (t.niches as unknown as { name: string } | null)?.name ?? '',
        ageDays,
      };
    },
  );

  // === "Depuis ta dernière visite" ===
  const recentChanges: RecentChange[] = [];

  // 1. New proposed topics since last visit (or last 7 days if no visit)
  const sinceDate = lastVisitDate
    ? lastVisitDate.toISOString()
    : new Date(Date.now() - 7 * 86_400_000).toISOString();

  const { data: newProposed } = await db
    .from('topics')
    .select('id, label, niche_id, niches(name)')
    .eq('status', 'proposed')
    .gte('created_at', sinceDate);

  const newByNiche = new Map<string, number>();
  for (const t of newProposed ?? []) {
    const name = (t.niches as unknown as { name: string } | null)?.name ?? 'Inconnue';
    newByNiche.set(name, (newByNiche.get(name) ?? 0) + 1);
  }
  for (const [nicheName, count] of newByNiche) {
    recentChanges.push({
      type: 'new_topics',
      label: `${count} nouveau${count > 1 ? 'x' : ''} sujet${count > 1 ? 's' : ''} détecté${count > 1 ? 's' : ''} dans ${nicheName}`,
      linkHref: '/topics/review',
      linkLabel: 'Valider',
    });
  }

  // 2. Phase changes: compare latest and previous score dates
  const { data: prevScoreRow } = await db
    .from('topic_scores')
    .select('scored_at')
    .lt('scored_at', scoredAt)
    .order('scored_at', { ascending: false })
    .limit(1)
    .single();

  if (prevScoreRow) {
    const { data: prevScores } = await db
      .from('topic_scores')
      .select('topic_id, phase, topics!inner(id, label)')
      .eq('scored_at', prevScoreRow.scored_at);

    const prevPhaseMap = new Map<string, number>();
    for (const s of prevScores ?? []) {
      prevPhaseMap.set(s.topic_id, s.phase as number);
    }

    for (const s of allTopicScores) {
      const topic = s.topics as unknown as { id: string; label: string };
      const currentPhase = s.phase as number;
      const prevPhase = prevPhaseMap.get(topic.id);
      if (prevPhase !== undefined && prevPhase !== currentPhase) {
        recentChanges.push({
          type: 'phase_change',
          label: topic.label,
          topicId: topic.id,
          fromPhase: prevPhase,
          toPhase: currentPhase,
        });
      }
    }
  }

  // 3. Burn-down alerts: phase 2 topics that will likely saturate soon (high supply trend)
  const burndownTopics = allTopicScores.filter((s: Record<string, unknown>) => {
    return s.phase === 2 && Number(s.supply_q) >= 2;
  });
  for (const s of burndownTopics) {
    const topic = s.topics as unknown as { id: string; label: string };
    recentChanges.push({
      type: 'burndown',
      label: `${topic.label} — l'offre augmente, la fenêtre se referme`,
      topicId: topic.id,
      linkHref: `/topics/${topic.id}`,
      linkLabel: 'Voir',
    });
  }

  // === Notable events from yesterday ===
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const { data: rawNotableEvents } = await db
    .from('video_events')
    .select(
      `id, video_id, event_type, old_value, new_value, meta, created_at,
       videos!inner(title, channels!inner(title))`,
    )
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })
    .limit(20);

  // Rank events: spikes first, then changes, then uploads. Take top 3.
  const eventPriority: Record<string, number> = { spike: 0, thumbnail_change: 1, title_change: 2, new_upload: 3 };
  const notableEvents: NotableEvent[] = (rawNotableEvents ?? [])
    .map((e: Record<string, unknown>) => {
      const video = e.videos as unknown as { title: string; channels: { title: string } };
      return {
        id: e.id as string,
        eventType: e.event_type as string,
        videoTitle: video.title,
        channelTitle: video.channels.title,
        videoId: e.video_id as string,
        meta: e.meta as Record<string, unknown> | null,
        oldValue: e.old_value as string | null,
        newValue: e.new_value as string | null,
        createdAt: e.created_at as string,
      };
    })
    .sort(
      (a: NotableEvent, b: NotableEvent) =>
        (eventPriority[a.eventType] ?? 9) - (eventPriority[b.eventType] ?? 9),
    )
    .slice(0, 3);

  // Subtitle
  const subtitleParts: string[] = [];
  if (idealCount > 0) subtitleParts.push(`${idealCount} sujet${idealCount > 1 ? 's sont' : ' est'} en fenêtre idéale`);
  if ((newProposed ?? []).length > 0) subtitleParts.push(`${(newProposed ?? []).length} nouveau${(newProposed ?? []).length > 1 ? 'x' : ''} à valider`);

  return (
    <div className="flex flex-col min-h-full">
      {/* Last visit tracker (client component that sets cookie) */}
      <LastVisitTracker />

      {/* Top bar */}
      <header className="h-[60px] shrink-0 flex items-center gap-4 px-6 md:px-8 border-b border-border bg-card">
        <label className="flex items-center gap-2 w-full max-w-[420px] h-9 px-3 border border-border rounded-lg bg-background text-muted-foreground text-sm">
          <Search className="size-4 shrink-0" />
          <input
            type="search"
            placeholder="Rechercher un sujet, une chaîne, une action…"
            className="flex-1 bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground text-sm"
            aria-label="Recherche"
            readOnly
          />
          <kbd className="hidden sm:inline font-mono text-[11px] px-1.5 py-0.5 border border-border rounded bg-card text-muted-foreground">
            ⌘K
          </kbd>
        </label>
        <div className="flex-1" />
        {allJobsOk ? (
          <span className="hidden md:flex items-center gap-2 text-[13px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full shrink-0 bg-success" />
            Collecte de la nuit OK · scores du {scoreDateFormatted}{scoreTime ? `, ${scoreTime}` : ''}
          </span>
        ) : (
          <Link
            href="/admin/jobs"
            className="hidden md:flex items-center gap-2 text-[13px] text-destructive hover:underline"
          >
            <span className="w-2 h-2 rounded-full shrink-0 bg-destructive" />
            Collecte incomplète — voir les jobs
          </Link>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 p-6 md:px-8 md:py-7 flex flex-col gap-6 overflow-x-hidden">
        {/* Title + actions */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[28px] font-semibold tracking-tight leading-tight">
              Quoi tourner cette semaine ?
            </h1>
            <p className="text-[15px] text-muted-foreground">
              {subtitleParts.length > 0 ? subtitleParts.join('. ') + '.' : 'Aucun score disponible pour le moment.'}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link
              href="/dashboard"
              className="h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center hover:bg-primary/90 transition-colors"
            >
              Ouvrir la matrice
            </Link>
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-[10px] p-4 shadow-[0_1px_2px_rgba(20,24,34,0.06)] flex flex-col gap-1.5">
            <span className="text-[13px] text-muted-foreground">Fenêtres idéales</span>
            <span className="text-[32px] font-semibold tabular-nums tracking-tight leading-none">{idealCount}</span>
          </div>
          <div className="bg-card border border-border rounded-[10px] p-4 shadow-[0_1px_2px_rgba(20,24,34,0.06)] flex flex-col gap-1.5">
            <span className="text-[13px] text-muted-foreground">Sujets suivis</span>
            <span className="text-[32px] font-semibold tabular-nums tracking-tight leading-none">{totalTracked}</span>
            {(newProposed ?? []).length > 0 && (
              <span className="text-[13px] text-muted-foreground">{(newProposed ?? []).length} nouveau{(newProposed ?? []).length > 1 ? 'x' : ''} à valider</span>
            )}
          </div>
          <div className="bg-card border border-border rounded-[10px] p-4 shadow-[0_1px_2px_rgba(20,24,34,0.06)] flex flex-col gap-1.5">
            <span className="text-[13px] text-muted-foreground">En production</span>
            <span className="text-[32px] font-semibold tabular-nums tracking-tight leading-none">{productionList.length}</span>
          </div>
          <div className="bg-card border border-border rounded-[10px] p-4 shadow-[0_1px_2px_rgba(20,24,34,0.06)] flex flex-col gap-1.5">
            <span className="text-[13px] text-muted-foreground">Vidéos TubLyTI à J+30</span>
            <span className="text-[32px] font-semibold tabular-nums tracking-tight leading-none">—</span>
            <span className="text-[13px] text-muted-foreground">Pas encore de données</span>
          </div>
        </div>

        {/* Channel columns */}
        {channelDataList.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {channelDataList.map((ch) => (
              <section
                key={ch.id}
                className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] flex flex-col"
              >
                <div className="flex items-center justify-between px-[18px] py-3.5 border-b border-border">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">{ch.title}</span>
                    <span className="text-xs text-muted-foreground">{ch.nicheName}</span>
                  </div>
                  <Link
                    href={`/dashboard?niche=${ch.nicheId}`}
                    className="text-[13px] font-medium text-primary hover:underline"
                  >
                    Tout voir
                  </Link>
                </div>

                {ch.topics.map((t, i) => (
                  <article
                    key={t.id}
                    className={`px-[18px] py-3.5 flex flex-col gap-2.5 ${
                      i < ch.topics.length - 1 ? 'border-b border-muted' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <PhaseBadge phase={t.phase} />
                        {t.feasibilityGrade && <FeasibilityBadge grade={t.feasibilityGrade} />}
                      </div>
                      <MgiScore value={t.mgi} />
                    </div>
                    <Link
                      href={`/topics/${t.id}`}
                      className="text-[15px] font-semibold text-foreground leading-snug hover:text-primary transition-colors"
                    >
                      {t.label}
                    </Link>
                    {t.quote && (
                      <p className="text-[13px] leading-[1.45] text-muted-foreground">
                        « {t.quote} »{' '}
                        {t.quoteLikes && (
                          <span className="text-muted-foreground/60">· {t.quoteLikes} likes</span>
                        )}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Link
                        href={`/topics/${t.id}`}
                        className="h-[30px] px-3 border border-border rounded-md text-foreground text-[13px] font-medium flex items-center hover:bg-muted transition-colors"
                      >
                        Voir
                      </Link>
                      <MarkProductionButton topicId={t.id} />
                    </div>
                  </article>
                ))}

                {ch.topics.length === 0 && (
                  <div className="px-[18px] py-6 text-center text-sm text-muted-foreground">
                    Aucun sujet scoré
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-[10px] p-8 shadow-[0_1px_2px_rgba(20,24,34,0.06)] text-center">
            <Sparkles className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-[15px] font-medium">Aucun sujet scoré pour le moment</p>
            <p className="text-sm text-muted-foreground mt-1">
              Ajoute des chaînes et lance la collecte pour voir les opportunités.
            </p>
            <Link
              href="/channels"
              className="inline-flex items-center gap-1 text-sm text-primary font-medium mt-3 hover:underline"
            >
              Ajouter des chaînes <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* Notable events */}
        {notableEvents.length > 0 && (
          <section className="bg-card border border-border rounded-[10px] p-4 shadow-[0_1px_2px_rgba(20,24,34,0.06)] flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Événements marquants</h2>
              <Link
                href="/activity"
                className="text-[13px] font-medium text-primary hover:underline"
              >
                Tout voir
              </Link>
            </div>
            {notableEvents.map((evt) => {
              const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
                new_upload: Upload,
                title_change: Type,
                thumbnail_change: Image,
                spike: TrendingUp,
              };
              const colorMap: Record<string, string> = {
                new_upload: 'text-phase-0 bg-phase-0/10',
                title_change: 'text-primary bg-primary/10',
                thumbnail_change: 'text-phase-2 bg-phase-2/10',
                spike: 'text-destructive bg-destructive/10',
              };
              const labelMap: Record<string, string> = {
                new_upload: 'Nouvel upload',
                title_change: 'Titre modifié',
                thumbnail_change: 'Miniature modifiée',
                spike: 'Pic de vues',
              };
              const Icon = iconMap[evt.eventType] ?? Upload;
              const color = colorMap[evt.eventType] ?? 'text-muted-foreground bg-muted';

              return (
                <div key={evt.id} className="flex items-start gap-2.5">
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-[13px]">
                      <span className="font-medium">{labelMap[evt.eventType] ?? evt.eventType}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground truncate">{evt.channelTitle}</span>
                    </div>
                    <p className="text-sm truncate">
                      {evt.videoTitle}
                    </p>
                    {evt.eventType === 'spike' && evt.meta && (
                      <span className="text-[13px] text-destructive font-medium">
                        {evt.meta.multiplier as number}× la médiane
                      </span>
                    )}
                    {evt.eventType === 'title_change' && evt.newValue && (
                      <p className="text-[13px] text-muted-foreground truncate">
                        → {evt.newValue}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* Bottom sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Depuis ta dernière visite */}
          <section className="bg-card border border-border rounded-[10px] p-4 shadow-[0_1px_2px_rgba(20,24,34,0.06)] flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold">
              Depuis ta dernière visite
            </h2>
            {recentChanges.length > 0 ? (
              recentChanges.map((change, i) => (
                <div key={i} className="flex items-start gap-2.5 text-sm">
                  {change.type === 'new_topics' && (
                    <Sparkles className="w-4 h-4 text-phase-0 shrink-0 mt-0.5" />
                  )}
                  {change.type === 'phase_change' && (
                    <ArrowRight className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  )}
                  {change.type === 'burndown' && (
                    <TrendingDown className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <span className="flex-1">
                    {change.type === 'phase_change' ? (
                      <>
                        <Link href={`/topics/${change.topicId}`} className="font-medium text-primary hover:underline">
                          {change.label}
                        </Link>
                        {' '}
                        <span className="text-muted-foreground">
                          {PHASE_LABELS[change.fromPhase!] ?? `Phase ${change.fromPhase}`}
                        </span>
                        <span className="text-muted-foreground mx-1">→</span>
                        <span className="font-medium">
                          {PHASE_LABELS[change.toPhase!] ?? `Phase ${change.toPhase}`}
                        </span>
                      </>
                    ) : (
                      change.label
                    )}
                  </span>
                  {change.linkHref && (
                    <Link href={change.linkHref} className="font-medium text-primary hover:underline shrink-0">
                      {change.linkLabel}
                    </Link>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Rien de nouveau pour le moment.
              </p>
            )}
          </section>

          {/* En production */}
          <section className="bg-card border border-border rounded-[10px] p-4 shadow-[0_1px_2px_rgba(20,24,34,0.06)] flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold">En production</h2>
            {productionList.length > 0 ? (
              productionList.map((t) => (
                <Link
                  key={t.id}
                  href={`/topics/${t.id}`}
                  className="flex items-center gap-2.5 text-sm hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors"
                >
                  <span className="flex-1 font-medium">{t.label}</span>
                  <span className="text-muted-foreground text-xs shrink-0">{t.nicheName}</span>
                  <span className="tabular-nums text-muted-foreground text-xs font-medium shrink-0">
                    J+{t.ageDays}
                  </span>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Aucun sujet en production.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
