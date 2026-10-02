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
  thumbnailUrl: string | null;
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

  // Build niche data (reusing ChannelData interface)
  const channelDataList: ChannelData[] = [];
  for (const [nicheId, niche] of nicheMap) {
    const allTopics = scoresByNiche.get(nicheId) ?? [];
    const topics = allTopics.slice(0, 3);
    if (topics.length === 0) continue;
    channelDataList.push({
      id: niche.id,
      title: niche.name,
      nicheName: `${allTopics.length} opportunité(s)`,
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
       videos!inner(title, thumbnail_url, channels!inner(title))`,
    )
    .gte('created_at', yesterday)
    .order('created_at', { ascending: false })
    .limit(20);

  // Rank events: spikes first, then changes, then uploads. Take top 3.
  const eventPriority: Record<string, number> = { spike: 0, thumbnail_change: 1, title_change: 2, new_upload: 3 };
  const notableEvents: NotableEvent[] = (rawNotableEvents ?? [])
    .map((e: Record<string, unknown>) => {
      const video = e.videos as unknown as { title: string; thumbnail_url: string | null; channels: { title: string } };
      return {
        id: e.id as string,
        eventType: e.event_type as string,
        videoTitle: video.title,
        channelTitle: video.channels.title,
        videoId: e.video_id as string,
        thumbnailUrl: video.thumbnail_url,
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
    <div className="flex flex-col min-h-full relative overflow-x-clip">
      {/* Background gradients multi-niveaux */}
      <div className="absolute inset-0 pointer-events-none -z-10">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/15 dark:bg-blue-600/15 blur-[100px]" />
        <div className="absolute top-[20%] -right-[10%] w-[40%] h-[60%] rounded-full bg-purple-400/15 dark:bg-purple-600/15 blur-[120px]" />
        <div className="absolute -bottom-[20%] left-[20%] w-[60%] h-[50%] rounded-full bg-cyan-400/15 dark:bg-cyan-600/15 blur-[100px]" />
      </div>

      {/* Last visit tracker (client component that sets cookie) */}
      <LastVisitTracker />

      {/* Top bar — translucent glass */}
      <header className="sticky top-0 z-20 h-[64px] shrink-0 flex items-center gap-4 px-6 md:px-8 border-b border-black/5 dark:border-white/10 bg-white/60 dark:bg-[#08090C]/60 backdrop-blur-2xl shadow-sm">
        <label className="flex items-center gap-3 w-full max-w-[420px] h-10 px-4 border border-black/5 dark:border-white/10 rounded-2xl bg-black/5 dark:bg-white/5 shadow-inner text-muted-foreground focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all cursor-text">
          <Search className="w-[18px] h-[18px] shrink-0" />
          <input
            type="search"
            placeholder="Rechercher un sujet, une chaîne, une action…"
            className="flex-1 bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground/70 text-[14px] font-medium"
            aria-label="Recherche"
            readOnly
          />
          <kbd className="hidden sm:inline font-mono text-[11px] px-2 py-0.5 rounded-[6px] bg-white dark:bg-white/10 border border-black/5 dark:border-white/10 text-muted-foreground shadow-sm">
            ⌘K
          </kbd>
        </label>
        <div className="flex-1" />
        {allJobsOk ? (
          <span className="hidden md:flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="w-2 h-2 rounded-full shrink-0 bg-success shadow-[0_0_6px_rgba(48,209,88,0.4)]" />
            Collecte OK · scores du {scoreDateFormatted}{scoreTime ? `, ${scoreTime}` : ''}
          </span>
        ) : (
          <Link
            href="/admin/jobs"
            className="hidden md:flex items-center gap-2 text-[12px] text-destructive hover:underline"
          >
            <span className="w-2 h-2 rounded-full shrink-0 bg-destructive shadow-[0_0_6px_rgba(255,69,58,0.4)]" />
            Collecte incomplète — voir les jobs
          </Link>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 p-5 md:px-10 md:py-8 flex flex-col gap-6 overflow-x-hidden w-full max-w-[1400px] mx-auto">
        {/* Title + actions */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-foreground">
              Quoi tourner cette semaine ?
            </h1>
            <p className="text-[15px] font-medium text-muted-foreground/80">
              {subtitleParts.length > 0 ? subtitleParts.join('. ') + '.' : 'Aucun score disponible pour le moment.'}
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Link
              href="/dashboard"
              className="haptic-btn h-10 px-4 rounded-xl bg-gradient-to-b from-primary to-blue-600 text-primary-foreground text-[14px] font-bold flex items-center gap-2 hover:opacity-90 transition-opacity shadow-[0_4px_14px_rgba(10,132,255,0.4)]"
            >
              Ouvrir la matrice
            </Link>
          </div>
        </div>

        {/* KPI grid — Premium glass cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-white/40 dark:border-white/10 shadow-sm rounded-2xl p-4 flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground font-semibold">Fenêtres idéales</span>
            <span className="text-[28px] font-bold text-mono-metric tabular-nums tracking-tight leading-none" style={{ color: idealCount > 0 ? '#30D158' : undefined }}>
              {idealCount}
            </span>
          </div>
          <div className="bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-white/40 dark:border-white/10 shadow-sm rounded-2xl p-4 flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground font-semibold">Sujets suivis</span>
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold text-mono-metric tabular-nums tracking-tight leading-none text-foreground">{totalTracked}</span>
              {(newProposed ?? []).length > 0 && (
                <span className="text-[11px] text-phase-0-ink font-semibold">
                  +{(newProposed ?? []).length} à valider
                </span>
              )}
            </div>
          </div>
          <div className="bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-white/40 dark:border-white/10 shadow-sm rounded-2xl p-4 flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground font-semibold">En production</span>
            <span className="text-[28px] font-bold text-mono-metric tabular-nums tracking-tight leading-none text-foreground">{productionList.length}</span>
          </div>
          <div className="bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-white/40 dark:border-white/10 shadow-sm rounded-2xl p-4 flex flex-col gap-1.5">
            <span className="text-[12px] text-muted-foreground font-semibold">Vidéos TubLyTI <span className="opacity-60 font-medium">J+30</span></span>
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold text-mono-metric tabular-nums tracking-tight leading-none text-muted-foreground/40">—</span>
              <span className="text-[11px] text-muted-foreground/70 font-medium">Pas encore de données</span>
            </div>
          </div>
        </div>

        {/* Channel columns */}
        {channelDataList.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {channelDataList.map((ch, idx) => {
              const gradients = [
                'from-blue-500/10 to-purple-500/10 dark:from-blue-500/20 dark:to-purple-500/20',
                'from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/20 dark:to-teal-500/20',
                'from-orange-500/10 to-red-500/10 dark:from-orange-500/20 dark:to-red-500/20',
                'from-indigo-500/10 to-cyan-500/10 dark:from-indigo-500/20 dark:to-cyan-500/20',
                'from-pink-500/10 to-rose-500/10 dark:from-pink-500/20 dark:to-rose-500/20',
                'from-amber-500/10 to-orange-500/10 dark:from-amber-500/20 dark:to-orange-500/20',
              ];
              const headerGradient = gradients[idx % gradients.length];
              const dotColors = [
                'bg-blue-500', 'bg-emerald-500', 'bg-orange-500', 'bg-indigo-500', 'bg-pink-500', 'bg-amber-500'
              ];
              const dotColor = dotColors[idx % dotColors.length];

              return (
                <section
                  key={ch.id}
                  className="bg-white/40 dark:bg-white/5 backdrop-blur-2xl border border-white/60 dark:border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col rounded-[24px] overflow-hidden relative group/card"
                >
                  <div className={`flex items-center justify-between gap-3 px-5 py-4 border-b border-white/50 dark:border-white/5 bg-gradient-to-r ${headerGradient}`}>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${dotColor} shadow-sm`} />
                        <span className="text-[15px] font-extrabold tracking-tight text-foreground truncate leading-tight">{ch.title}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground font-semibold truncate mt-1 pl-4">{ch.nicheName}</span>
                    </div>
                    <Link
                      href={`/dashboard?niche=${ch.nicheId}`}
                      className="text-[12px] font-bold text-primary hover:text-white hover:bg-primary transition-all bg-white dark:bg-white/10 shadow-sm border border-primary/20 px-3 py-1.5 rounded-full whitespace-nowrap shrink-0"
                    >
                      Explorer
                    </Link>
                  </div>

                  <div className="flex flex-col p-3 gap-3 bg-black/[0.01] dark:bg-transparent">
                    {ch.topics.map((t) => (
                      <article
                        key={t.id}
                        className="group relative px-4 py-3.5 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl flex flex-col gap-2.5 transition-all hover:shadow-[0_4px_20px_rgb(0,0,0,0.06)] hover:border-primary/20 dark:hover:border-primary/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <Link
                            href={`/topics/${t.id}`}
                            className="text-[14.5px] font-bold leading-snug hover:text-primary transition-colors pr-6 text-foreground/90 group-hover:text-foreground"
                          >
                            <span className="absolute inset-0 z-10" aria-hidden="true" />
                            {t.label}
                          </Link>
                          <div className="shrink-0 relative z-20 mt-[-2px] scale-[0.85] origin-right">
                            <MgiScore value={t.mgi} />
                          </div>
                        </div>
                        
                        {t.quote && (
                          <p className="text-[13px] leading-relaxed text-muted-foreground/80 italic line-clamp-2 -mt-1 bg-black/5 dark:bg-white/5 p-2.5 rounded-xl border border-black/5 dark:border-white/5">
                            « {t.quote} »
                          </p>
                        )}

                        <div className="flex items-center justify-between mt-0.5 relative z-20">
                          <div className="flex items-center gap-1.5 scale-[0.9] origin-left">
                            <PhaseBadge phase={t.phase} />
                            {t.feasibilityGrade && <FeasibilityBadge grade={t.feasibilityGrade} />}
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity scale-90 origin-right">
                            <MarkProductionButton topicId={t.id} />
                          </div>
                        </div>
                      </article>
                    ))}

                    {ch.topics.length === 0 && (
                      <div className="px-5 py-8 text-center text-[13px] text-muted-foreground font-medium">
                        Aucun sujet scoré
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[24px] py-12 px-6 text-center">
            <Sparkles className="w-8 h-8 text-muted-foreground/60 mx-auto mb-4" />
            <p className="text-[20px] font-bold tracking-tight text-foreground mb-1">Aucun sujet scoré pour le moment</p>
            <p className="text-[14px] text-muted-foreground mt-1 max-w-sm mx-auto">
              Ajoute des chaînes et lance la collecte pour voir les opportunités.
            </p>
            <Link
              href="/channels"
              className="inline-flex items-center gap-1.5 text-[14px] text-primary font-semibold mt-4 hover:underline"
            >
              Ajouter des chaînes <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {/* Notable events */}
        {notableEvents.length > 0 && (
          <section className="bg-white/40 dark:bg-white/5 backdrop-blur-2xl border border-white/60 dark:border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col rounded-[24px] overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/50 dark:border-white/5 bg-gradient-to-r from-blue-500/5 to-purple-500/5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 shadow-sm" />
                <h2 className="text-[15px] font-extrabold tracking-tight text-foreground truncate leading-tight">Événements marquants</h2>
              </div>
              <Link
                href="/activity"
                className="text-[12px] font-bold text-primary hover:text-white hover:bg-primary transition-all bg-white dark:bg-white/10 shadow-sm border border-primary/20 px-3 py-1.5 rounded-full whitespace-nowrap shrink-0"
              >
                Explorer
              </Link>
            </div>
            
            <div className="flex flex-col p-3 gap-3 bg-black/[0.01] dark:bg-transparent">
              {notableEvents.map((evt) => {
                const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
                  new_upload: Upload,
                  title_change: Type,
                  thumbnail_change: Image,
                  spike: TrendingUp,
                };
                const colorMap: Record<string, string> = {
                  new_upload: 'text-phase-0-ink bg-phase-0-soft border border-phase-0/20',
                  title_change: 'text-primary bg-primary/10 border border-primary/20',
                  thumbnail_change: 'text-phase-2-ink bg-phase-2-soft border border-phase-2/20',
                  spike: 'text-destructive bg-destructive/10 border border-destructive/20',
                };
                const labelMap: Record<string, string> = {
                  new_upload: 'Nouvel upload',
                  title_change: 'Titre modifié',
                  thumbnail_change: 'Miniature modifiée',
                  spike: 'Pic de vues',
                };
                const Icon = iconMap[evt.eventType] ?? Upload;
                const color = colorMap[evt.eventType] ?? 'text-muted-foreground bg-[--bg-surface-2] border border-[--glass-border]';

                return (
                  <div key={evt.id} className="group relative px-4 py-3.5 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl flex items-start gap-4 transition-all hover:shadow-[0_4px_20px_rgb(0,0,0,0.06)]">
                    
                    {/* Visual / Thumbnail */}
                    {evt.eventType === 'thumbnail_change' && evt.oldValue && evt.newValue ? (
                      <div className="flex flex-col gap-1.5 shrink-0 w-[120px] pt-1">
                        <div className="relative aspect-video rounded-md overflow-hidden opacity-50 grayscale transition-all group-hover:opacity-100 group-hover:grayscale-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={evt.oldValue} alt="" className="object-cover w-full h-full" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[9px] uppercase tracking-wider font-bold bg-black/60 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">Avant</span>
                          </div>
                        </div>
                        <div className="relative aspect-video rounded-md overflow-hidden shadow-sm border border-black/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={evt.newValue} alt="" className="object-cover w-full h-full" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[9px] uppercase tracking-wider font-bold bg-green-500/80 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">Après</span>
                          </div>
                        </div>
                      </div>
                    ) : evt.thumbnailUrl ? (
                      <div className="relative aspect-video w-[120px] rounded-lg overflow-hidden shrink-0 shadow-sm border border-black/5 mt-0.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={evt.thumbnailUrl} alt="" className="object-cover w-full h-full" />
                        <div className={`absolute top-1.5 left-1.5 w-6 h-6 rounded-md flex items-center justify-center backdrop-blur-md shadow-sm ${color}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    ) : (
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm mt-0.5 ${color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center min-h-[40px] py-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
                        <span className={color.split(' ')[0]}>{labelMap[evt.eventType] ?? evt.eventType}</span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-muted-foreground truncate">{evt.channelTitle}</span>
                      </div>
                      <p className="text-[14.5px] font-bold leading-snug mt-1 truncate text-foreground/90 group-hover:text-foreground transition-colors">
                        {evt.videoTitle}
                      </p>
                      
                      {evt.eventType === 'spike' && evt.meta && (
                        <div className="mt-2.5">
                          <span className="inline-flex items-center gap-1.5 text-[12px] text-destructive font-semibold px-2.5 py-1 rounded-md bg-destructive/10 border border-destructive/20">
                            <TrendingUp className="w-3.5 h-3.5" />
                            {evt.meta.multiplier as number}× la médiane
                          </span>
                        </div>
                      )}
                      
                      {evt.eventType === 'title_change' && evt.oldValue && evt.newValue && (
                        <div className="mt-2.5 flex flex-col gap-1.5 bg-black/5 dark:bg-white/5 p-2.5 rounded-xl border border-black/5 dark:border-white/5">
                          <p className="text-[12px] text-muted-foreground line-through opacity-70 truncate" title={evt.oldValue}>
                            {evt.oldValue}
                          </p>
                          <p className="text-[13px] text-foreground font-medium truncate" title={evt.newValue}>
                            {evt.newValue}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Bottom sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Depuis ta dernière visite */}
          <section className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[24px] p-6 flex flex-col gap-5">
            <h2 className="text-[20px] font-bold tracking-tight text-foreground">
              Depuis ta dernière visite
            </h2>
            <div className="flex flex-col gap-4">
              {recentChanges.length > 0 ? (
                recentChanges.map((change, i) => (
                  <div key={i} className="flex items-start gap-3 text-[14px]">
                    {change.type === 'new_topics' && (
                      <div className="w-6 h-6 rounded bg-phase-0-soft flex items-center justify-center shrink-0 mt-0.5 border border-phase-0/20">
                        <Sparkles className="w-3.5 h-3.5 text-phase-0-ink" />
                      </div>
                    )}
                    {change.type === 'phase_change' && (
                      <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center shrink-0 mt-0.5 border border-primary/20">
                        <ArrowRight className="w-3.5 h-3.5 text-primary" />
                      </div>
                    )}
                    {change.type === 'burndown' && (
                      <div className="w-6 h-6 rounded bg-destructive/10 flex items-center justify-center shrink-0 mt-0.5 border border-destructive/20">
                        <TrendingDown className="w-3.5 h-3.5 text-destructive" />
                      </div>
                    )}
                    <span className="flex-1 pt-0.5 leading-snug">
                      {change.type === 'phase_change' ? (
                        <>
                          <Link href={`/topics/${change.topicId}`} className="font-semibold text-foreground hover:text-primary transition-colors">
                            {change.label}
                          </Link>
                          {' '}
                          <span className="text-muted-foreground/80">
                            {PHASE_LABELS[change.fromPhase!] ?? `Phase ${change.fromPhase}`}
                          </span>
                          <span className="text-muted-foreground/60 mx-1.5">→</span>
                          <span className="font-semibold text-foreground">
                            {PHASE_LABELS[change.toPhase!] ?? `Phase ${change.toPhase}`}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{change.label}</span>
                      )}
                    </span>
                    {change.linkHref && (
                      <Link href={change.linkHref} className="pt-0.5 font-semibold text-primary hover:underline shrink-0">
                        {change.linkLabel}
                      </Link>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-[14px] text-muted-foreground">
                  Rien de nouveau pour le moment.
                </p>
              )}
            </div>
          </section>

          {/* En production */}
          <section className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[24px] p-6 flex flex-col gap-5">
            <h2 className="text-[20px] font-bold tracking-tight text-foreground">En production</h2>
            <div className="flex flex-col gap-1.5">
              {productionList.length > 0 ? (
                productionList.map((t) => (
                  <Link
                    key={t.id}
                    href={`/topics/${t.id}`}
                    className="group flex items-center gap-3 text-[14px] hover:bg-black/5 dark:hover:bg-white/5 -mx-3 px-3 py-3 rounded-[14px] transition-all border border-transparent hover:border-black/5 dark:hover:border-white/10"
                  >
                    <span className="flex-1 font-semibold text-foreground group-hover:text-primary transition-colors">{t.label}</span>
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70 shrink-0">{t.nicheName}</span>
                    <span className="tabular-nums text-mono-metric text-foreground text-[12px] font-bold shrink-0 bg-white dark:bg-white/10 px-2.5 py-1 rounded-md border border-black/5 dark:border-white/10 shadow-sm">
                      J+{t.ageDays}
                    </span>
                  </Link>
                ))
              ) : (
                <p className="text-[14px] text-muted-foreground mt-1">
                  Aucun sujet en production.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
