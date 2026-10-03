import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser, isDbReady } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { PhaseBadge, MgiScore, PHASE_LABELS } from '@/components/tublyti';
import { getMgiBand, type ConfidenceResult } from '@/lib/scoring/mgi';
import { OutlierBadge } from '@/components/tublyti/outlier-badge';
import { TopicActions } from './_components/topic-actions';
import { TopicShortcuts } from './_components/topic-shortcuts';
import { AngleSection } from './_components/angle-section';
import { DossierExport } from './_components/dossier-export';
import { getFavoriteIds } from '@/lib/actions/collections';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const db = createServiceClient();
  const { data } = await db.from('topics').select('label').eq('id', id).single();
  return { title: data?.label ? `${data.label} - Dossier` : 'Dossier Sujet' };
}

const LABEL_NAMES: Record<string, string> = {
  no_one_explains: "Personne n'explique",
  wish_video_on: 'Souhait de vidéo',
  stopped_too_early: "S'arrête trop tôt",
  searched_long: 'Longue recherche',
};

const COMPETITOR_TAGS: Record<string, { label: string; color: string }> = {
  qualified: { label: 'Qualifiée', color: 'text-phase-2-ink' },
  old: { label: 'Ancienne', color: 'text-phase-1-ink' },
  off_topic: { label: 'Hors sujet', color: 'text-muted-foreground' },
  short: { label: 'Short', color: 'text-muted-foreground' },
};

interface Competitor {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  views: number;
  durationSec: number;
  tag: string;
  outlier: { score: number; ageDays: number; method: 'same_age' | 'approximate'; baseline: number } | null;
}

interface FrustrationComment {
  commentId: string;
  text: string;
  likeCount: number;
  label: string;
  requestedAngle: string | null;
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return String(n);
}

function formatRelativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "aujourd'hui";
  if (days < 30) return `il y a ${days} j`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(months / 12);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

function formatDuration(sec: number): string {
  if (sec < 60) return 'Short';
  const m = Math.floor(sec / 60);
  return `${m} min`;
}

function classifyCompetitor(video: {
  publishedAt: string;
  durationSec: number;
}): string {
  if (video.durationSec < 60) return 'short';
  const sixMonthsAgo = Date.now() - 180 * 86_400_000;
  if (new Date(video.publishedAt).getTime() < sixMonthsAgo) return 'old';
  return 'qualified';
}

function formatScoredAtFreshness(scoredAt: string): string {
  const diff = Date.now() - new Date(scoredAt).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'mis \u00e0 jour \u00e0 l\u2019instant';
  if (hours < 24) return `mis \u00e0 jour il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `mis \u00e0 jour il y a ${days} j`;
}

function formatLikes(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)} k`;
  return String(n);
}

export default async function TopicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const db = createServiceClient();

  // Topic + niche
  const { data: topic, error } = await db
    .from('topics')
    .select('id, label, phase, status, created_at, niches(id, name, rpm_coefficient, rpm_low, rpm_high, rpm_source)')
    .eq('id', id)
    .single();

  if (error || !topic) notFound();

  // Un client ne voit que les sujets de ses thématiques (l'admin voit tout).
  if (user.role !== 'admin') {
    const { nicheIds } = await resolveScope(db, user.id);
    const topicNiche = (topic.niches as unknown as { id: string } | null)?.id;
    if (!topicNiche || !nicheIds.includes(topicNiche)) notFound();
  }

  // Latest score
  const { data: score } = await db
    .from('topic_scores')
    .select('mgi, demand, frustration, supply_q, monetization, phase, scored_at, confidence, confidence_reason, feasibility_grade, feasibility_reason')
    .eq('topic_id', id)
    .order('scored_at', { ascending: false })
    .limit(1)
    .single();

  // Previous score (7 days ago) for delta
  let mgiDelta: number | null = null;
  if (score) {
    const prevDate = new Date(new Date(score.scored_at).getTime() - 7 * 86_400_000)
      .toISOString().slice(0, 10);
    const { data: prevScore } = await db
      .from('topic_scores')
      .select('mgi')
      .eq('topic_id', id)
      .eq('scored_at', prevDate)
      .single();
    if (prevScore) {
      mgiDelta = Number(score.mgi) - Number(prevScore.mgi);
    }
  }

  // Videos (competitors)
  const { data: videos } = await db
    .from('videos')
    .select('id, title, published_at, duration_seconds, is_qualified, channel_id, channels(title)')
    .eq('topic_id', id)
    .order('published_at', { ascending: false })
    .limit(20);

  // Get latest views
  const videoIds = (videos ?? []).map((v: Record<string, unknown>) => v.id as string);
  let videoViews: Record<string, number> = {};
  if (videoIds.length > 0) {
    const { data: snaps } = await db
      .from('video_snapshots')
      .select('video_id, views')
      .in('video_id', videoIds)
      .order('captured_at', { ascending: false });

    const seen = new Set<string>();
    for (const s of snaps ?? []) {
      if (!seen.has(s.video_id)) {
        seen.add(s.video_id);
        videoViews[s.video_id] = s.views ?? 0;
      }
    }
  }

  // Fetch outlier scores for these videos
  let videoOutliers: Record<string, { score: number; ageDays: number; method: string; baseline: number }> = {};
  if (videoIds.length > 0) {
    const { data: outliers } = await db
      .from('video_outliers')
      .select('video_id, score, age_days, method, baseline')
      .in('video_id', videoIds);

    for (const o of outliers ?? []) {
      videoOutliers[o.video_id as string] = {
        score: Number(o.score),
        ageDays: o.age_days as number,
        method: o.method as string,
        baseline: Number(o.baseline),
      };
    }
  }

  const competitors: Competitor[] = (videos ?? []).map((v: Record<string, unknown>) => {
    const durationSec = (v.duration_seconds as number) ?? 0;
    const publishedAt = v.published_at as string;
    const tag = classifyCompetitor({ publishedAt, durationSec });
    const vid = v.id as string;
    const outlier = videoOutliers[vid] ?? null;
    return {
      id: vid,
      title: v.title as string,
      channelTitle: (v.channels as unknown as { title: string })?.title ?? '',
      channelId: v.channel_id as string,
      publishedAt,
      views: videoViews[vid] ?? 0,
      durationSec,
      tag,
      outlier: outlier ? { ...outlier, method: outlier.method as 'same_age' | 'approximate' } : null,
    };
  });

  // Frustrated comments
  const { data: frustrations } = await db
    .from('comment_labels')
    .select(`
      label, requested_angle, confidence,
      comments!inner(id, text, like_count, video_id, videos!inner(topic_id))
    `)
    .eq('comments.videos.topic_id', id)
    .neq('label', 'none')
    .gte('confidence', 0.7)
    .order('comments(like_count)', { ascending: false })
    .limit(20);

  const frustrationList: FrustrationComment[] = (frustrations ?? []).map((f: Record<string, unknown>) => {
    const comment = f.comments as unknown as {
      id: string; text: string; like_count: number;
    };
    return {
      commentId: comment.id,
      text: comment.text,
      likeCount: comment.like_count,
      label: f.label as string,
      requestedAngle: (f.requested_angle as string) ?? null,
    };
  });

  // Angles
  let anglesQ = db
    .from('angles')
    .select('id, title, hook, rationale, status, video_id, created_at')
    .eq('topic_id', id)
    .order('created_at', { ascending: false });
  if (await isDbReady()) anglesQ = anglesQ.or(`user_id.is.null,user_id.eq.${user.id}`);
  const { data: angles } = await anglesQ;

  // Signals (90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const { data: trendPoints } = await db
    .from('trend_points')
    .select('source, captured_at, value')
    .eq('topic_id', id)
    .gte('captured_at', ninetyDaysAgo)
    .order('captured_at', { ascending: true });

  const signals: Record<string, { date: string; value: number }[]> = {
    trends: [], hn: [], yt_views: [],
  };
  for (const point of trendPoints ?? []) {
    const source = point.source as string;
    if (source in signals) {
      signals[source].push({ date: point.captured_at, value: point.value });
    }
  }

  // Check if topic is in favorites
  const { data: favoriteTopicIds } = await getFavoriteIds('topic');
  const isFavorite = favoriteTopicIds.includes(id);

  const phase = score?.phase ?? topic.phase;
  const niche = topic.niches as unknown as {
    id: string; name: string; rpm_coefficient: number;
    rpm_low: number | null; rpm_high: number | null; rpm_source: string | null;
  } | null;

  const daysSinceCreated = Math.floor(
    (Date.now() - new Date(topic.created_at).getTime()) / 86_400_000,
  );

  const totalFrustrated = frustrationList.length;

  // Estimate total comments from frustration ratio
  let totalComments = 0;
  if (score && Number(score.frustration) > 0) {
    totalComments = Math.round(totalFrustrated / Number(score.frustration));
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Breadcrumb header */}
      <header className="h-[60px] shrink-0 flex items-center gap-3 px-8 border-b border-border bg-card text-[14px] text-muted-foreground">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
          Matrice
        </Link>
        <span className="text-border">/</span>
        <Link href={`/dashboard${niche ? `?niche=${niche.id}` : ''}`} className="text-muted-foreground hover:text-foreground transition-colors">
          {niche?.name ?? 'Niche'}
        </Link>
        <span className="text-border">/</span>
        <span className="text-foreground font-medium truncate">{topic.label}</span>
      </header>

      <div className="flex-1 p-7 flex flex-col gap-5">
        {/* Title row */}
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <PhaseBadge phase={phase} />
              <span className="text-[13px] text-muted-foreground">
                Ouverte depuis {daysSinceCreated} jour{daysSinceCreated !== 1 ? 's' : ''}
              </span>
            </div>
            <h1 className="text-[30px] font-semibold tracking-[-0.02em] leading-tight">
              {topic.label}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <DossierExport topicId={id} />
            <TopicActions topicId={id} status={topic.status} isFavorite={isFavorite} />
          </div>
        </div>
        <TopicShortcuts topicId={id} status={topic.status} hasBrief={(angles ?? []).length > 0} />

        {/* Stale data banner */}
        {score && (Date.now() - new Date(score.scored_at).getTime() > 36 * 3_600_000) && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] bg-[var(--warning)]/10 text-[var(--warning)] text-[13px] border border-[var(--warning)]/20">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Les données ont plus de 36 h. Le cron de collecte est peut-être en panne.
          </div>
        )}

        {/* 5 MGI component cards */}
        {score && (() => {
          const mgiVal = Number(score.mgi);
          const band = getMgiBand(mgiVal);
          const confidenceData: ConfidenceResult | null = score.confidence
            ? { level: score.confidence as 'high' | 'medium' | 'low', reason: score.confidence_reason ?? '' }
            : null;
          return (
          <div className="grid gap-4" style={{ gridTemplateColumns: '1.3fr 1fr 1fr 1fr 1fr' }}>
            {/* MGI card */}
            <div className="bento-card !px-[18px] !py-4 flex flex-col gap-1.5">
              <span className="text-[13px] text-muted-foreground font-medium">Market Gap Index</span>
              <div className="flex items-baseline gap-2">
                <span className="text-display-giant text-mono-metric tabular-nums tracking-tight">
                  {Math.round(mgiVal)}
                </span>
                <span
                  className="text-[12px] font-semibold px-2 py-0.5 rounded-lg"
                  style={{
                    backgroundColor: band.color + '20',
                    color: band.color === '#e2e6ff' || band.color === '#b7c0f8' ? '#424882' : band.color,
                  }}
                >
                  {band.label}
                </span>
                {mgiDelta !== null && (
                  <span className={`text-[13px] font-medium ${mgiDelta >= 0 ? 'text-phase-2-ink' : 'text-phase-3-ink'}`}>
                    {mgiDelta >= 0 ? '+' : ''}{Math.round(mgiDelta)} en 7 j
                  </span>
                )}
              </div>
              <span className="block h-1.5 rounded-full bg-[--bg-surface-2] overflow-hidden mt-1">
                <span
                  className="block h-1.5 rounded-full"
                  style={{
                    width: `${Math.min(mgiVal, 100)}%`,
                    backgroundColor: band.color,
                  }}
                />
              </span>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                {confidenceData && (
                  <span className="group relative cursor-help flex items-center gap-1 font-medium">
                    <span className={`w-1.5 h-1.5 rounded-full shadow-[0_0_4px_currentColor] ${
                      confidenceData.level === 'high' ? 'bg-[#30D158] text-[#30D158]'
                      : confidenceData.level === 'medium' ? 'bg-[#FF9F0A] text-[#FF9F0A]'
                      : 'bg-[#FF453A] text-[#FF453A]'
                    }`} />
                    Fiabilité : {confidenceData.level === 'high' ? 'Élevée' : confidenceData.level === 'medium' ? 'Moyenne' : 'Faible'}
                    <span className="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-[--bg-surface-2] text-foreground text-[11px] px-2 py-1 rounded shadow-md border border-[--glass-border] whitespace-nowrap z-10 backdrop-blur-md">
                      {confidenceData.reason}
                    </span>
                  </span>
                )}
                {confidenceData && <span className="text-[--glass-border]">·</span>}
                <span className={`font-medium ${Date.now() - new Date(score.scored_at).getTime() > 36 * 3_600_000 ? 'text-[#FF9F0A]' : ''}`}>
                  {formatScoredAtFreshness(score.scored_at)}
                </span>
              </div>
            </div>
            <ScoreCard label="Demande" value={String(Math.round(Number(score.demand)))} sub="Trends" />
            <ScoreCard label="Vidéos de qualité existantes" value={String(Math.round(Number(score.supply_q)))} sub="vidéo(s) de qualité en 180 j" />
            <ScoreCard
              label="Frustration"
              value={`${Math.round(Number(score.frustration) * 100)} %`}
              sub={totalComments > 0 ? `sur ${totalComments.toLocaleString('fr-FR')} commentaires` : undefined}
            />
            <ScoreCard
              label="Monétisation"
              value={niche?.rpm_low && niche?.rpm_high ? `${niche.rpm_low}–${niche.rpm_high} $` : `× ${Number(score.monetization).toFixed(1)}`}
              sub={niche?.rpm_source ? `Source : ${niche.rpm_source}` : niche ? `catégorie ${niche.name}` : undefined}
            />
          </div>
          );
        })()}

        {/* Feasibility card */}
        {score?.feasibility_grade && (
          <div className="bento-card !px-[18px] !py-3.5 flex items-center gap-3">
            <span className={`inline-flex items-center justify-center h-8 w-8 rounded-[8px] text-[16px] font-bold ${
              score.feasibility_grade === 'A' ? 'bg-[#30D158]/15 text-[#30D158]'
              : score.feasibility_grade === 'B' ? 'bg-[#0A84FF]/15 text-[#0A84FF]'
              : score.feasibility_grade === 'C' ? 'bg-[--bg-surface-2] text-muted-foreground'
              : score.feasibility_grade === 'D' ? 'bg-[#FF9F0A]/15 text-[#FF9F0A]'
              : 'bg-[#FF453A]/15 text-[#FF453A]'
            }`}>
              {score.feasibility_grade}
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold">Faisabilité</span>
              <span className="text-[13px] text-muted-foreground">
                {score.feasibility_reason ?? `Note ${score.feasibility_grade}`}
              </span>
            </div>
          </div>
        )}

        {/* Two-column layout */}
        <div className="flex gap-4 items-start">
          {/* Left column */}
          <div className="flex-1 min-w-0 flex flex-col gap-5">
            <SignalSection signals={signals} />

            {/* Frustrations */}
            <section className="bento-card !p-0 flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[--glass-border] bg-[--bg-surface-1]/50">
                <h2 className="text-headline">Ce que les spectateurs réclament</h2>
                <span className="text-[13px] font-medium text-muted-foreground bg-[--bg-surface-2] px-2 py-0.5 rounded border border-[--glass-border]">
                  {totalFrustrated} commentaire{totalFrustrated !== 1 ? 's' : ''} frustré{totalFrustrated !== 1 ? 's' : ''}
                </span>
              </div>
              {frustrationList.length === 0 ? (
                <div className="px-5 py-10 text-center text-[14px] text-muted-foreground font-medium">
                  Aucun commentaire de frustration détecté.
                </div>
              ) : (
                frustrationList.map((f) => (
                  <div key={f.commentId} className="px-5 py-4 border-b border-[--glass-border] flex flex-col gap-2.5 last:border-0 hover:bg-[--bg-surface-1]/30 transition-colors">
                    <p className="text-[14px] leading-relaxed text-foreground/90 italic">« {f.text} »</p>
                    <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
                      <span className="h-6 px-2 rounded-md bg-[--bg-surface-2] border border-[--glass-border] inline-flex items-center font-semibold uppercase tracking-wider text-muted-foreground">
                        {LABEL_NAMES[f.label] ?? f.label}
                      </span>
                      {f.requestedAngle && (
                        <span>
                          Angle demandé : <span className="font-semibold text-primary">{f.requestedAngle}</span>
                        </span>
                      )}
                      <span className="ml-auto tabular-nums text-mono-metric font-medium">{formatLikes(f.likeCount)} likes</span>
                    </div>
                  </div>
                ))
              )}
            </section>
          </div>

          {/* Right column */}
          <div className="w-[400px] shrink-0 flex flex-col gap-5">
            <AngleSection
              topicId={id}
              angles={angles ?? []}
              briefData={{
                topicLabel: topic.label,
                nicheName: niche?.name ?? '?',
                rpmCoefficient: niche?.rpm_coefficient ?? 1,
                phaseLabel: phase !== null && phase !== undefined ? (PHASE_LABELS[phase] ?? String(phase)) : '?',
                mgi: score ? Number(score.mgi) : null,
                demand: score ? Number(score.demand) : null,
                supply: score ? Number(score.supply_q) : null,
                frustrationScore: score ? Number(score.frustration) : null,
                monetization: score ? Number(score.monetization) : null,
                date: score?.scored_at ?? new Date().toISOString().slice(0, 10),
                frustrations: frustrationList.map((f) => ({
                  text: f.text,
                  likeCount: f.likeCount,
                  requestedAngle: f.requestedAngle,
                  commentId: f.commentId,
                })),
                competitors: competitors.map((c) => ({
                  title: c.title,
                  channelTitle: c.channelTitle,
                  views: c.views,
                  videoId: c.id,
                })),
              }}
            />

            {/* Competitors */}
            <section className="bento-card !p-0 flex flex-col">
              <div className="px-5 py-4 border-b border-[--glass-border] bg-[--bg-surface-1]/50">
                <h2 className="text-headline">Concurrents</h2>
              </div>
              {competitors.length === 0 ? (
                <div className="px-5 py-8 text-center text-[14px] text-muted-foreground font-medium">
                  Aucune vidéo trouvée pour ce sujet.
                </div>
              ) : (
                competitors.map((c) => {
                  const tagInfo = COMPETITOR_TAGS[c.tag] ?? { label: c.tag, color: 'text-muted-foreground' };
                  return (
                    <div key={c.id} className="px-5 py-3.5 border-b border-[--glass-border] flex gap-3.5 items-center last:border-0 hover:bg-[--bg-surface-1]/30 transition-colors">
                      <a href={`https://youtube.com/watch?v=${c.id}`} target="_blank" rel="noopener noreferrer" className="shrink-0 relative group">
                        <img 
                          src={`https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`} 
                          alt={c.title} 
                          className="w-[72px] h-[40px] object-cover rounded-lg border border-[--glass-border] shadow-sm transition-transform group-hover:scale-105"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 5V19L19 12L8 5Z" />
                          </svg>
                        </div>
                      </a>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <a href={`https://youtube.com/watch?v=${c.id}`} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold truncate text-foreground/90 hover:text-primary transition-colors">
                          {c.title}
                        </a>
                        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 shrink-0 flex items-center justify-center text-[8px] font-bold text-white uppercase">
                            {c.channelTitle.charAt(0)}
                          </div>
                          <a href={`https://youtube.com/channel/${c.channelId}`} target="_blank" rel="noopener noreferrer" className="hover:underline truncate max-w-[120px]">
                            {c.channelTitle}
                          </a>
                          <span>·</span>
                          <span className="text-mono-metric tabular-nums font-medium shrink-0">{formatViews(c.views)} vues</span>
                          <span className="shrink-0">· {formatRelativeDate(c.publishedAt)} · {formatDuration(c.durationSec)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.outlier && (
                          <OutlierBadge
                            score={c.outlier.score}
                            ageDays={c.outlier.ageDays}
                            method={c.outlier.method}
                            baseline={c.outlier.baseline}
                          />
                        )}
                        <span className={`text-[11px] font-bold uppercase tracking-wider ${tagInfo.color} bg-[--bg-surface-2] px-1.5 py-0.5 rounded border border-[--glass-border]`}>
                          {tagInfo.label}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bento-card !px-[18px] !py-4 flex flex-col gap-1.5">
      <span className="text-[13px] text-muted-foreground font-medium">{label}</span>
      <span className="text-display-giant text-mono-metric tabular-nums tracking-tight">{value}</span>
      {sub && <span className="text-[12px] text-muted-foreground/80">{sub}</span>}
    </div>
  );
}

const SIGNAL_COLORS: Record<string, string> = {
  trends: '#0A84FF',
  yt_views: '#30D158',
  hn: '#FF9F0A',
};

const SIGNAL_LABELS: Record<string, string> = {
  trends: 'Google Trends',
  yt_views: 'Vues YouTube / vidéo',
  hn: 'Hacker News',
};

function SignalSection({ signals }: { signals: Record<string, { date: string; value: number }[]> }) {
  const activeSources = Object.keys(signals).filter((s) => signals[s].length > 0);

  if (activeSources.length === 0) {
    return (
      <section className="bento-card px-5 py-4">
        <h2 className="text-headline mb-3">Signaux sur 90 jours</h2>
        <p className="text-[14px] text-muted-foreground font-medium">Aucune donnée de signal disponible.</p>
      </section>
    );
  }

  const allDates = [...new Set(activeSources.flatMap((s) => signals[s].map((p) => p.date)))].sort();
  if (allDates.length === 0) return null;

  const W = 680;
  const H = 220;
  const L = 36;
  const R = 676;
  const T = 20;
  const B = 190;

  const minDate = new Date(allDates[0]).getTime();
  const maxDate = new Date(allDates[allDates.length - 1]).getTime();
  const dateRange = maxDate - minDate || 1;

  function toX(date: string): number {
    return L + ((new Date(date).getTime() - minDate) / dateRange) * (R - L);
  }

  const dateLabels = [...new Set([
    allDates[0],
    allDates[Math.floor(allDates.length / 3)],
    allDates[Math.floor((allDates.length * 2) / 3)],
    allDates[allDates.length - 1],
  ])].filter(Boolean);

  return (
    <section className="bento-card px-5 py-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-headline">Signaux sur 90 jours</h2>
        <div className="flex gap-4 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          {activeSources.map((source) => (
            <span key={source} className="flex items-center gap-1.5">
              <span className="w-3 h-[3px] rounded-sm" style={{ backgroundColor: SIGNAL_COLORS[source] }} />
              {SIGNAL_LABELS[source] ?? source}
            </span>
          ))}
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} role="img" aria-label="Signaux sur 90 jours">
        <g stroke="var(--glass-border)" strokeDasharray="3 4">
          {[T, 80, 140].map((y) => (
            <line key={y} x1={L} y1={y} x2={R} y2={y} />
          ))}
        </g>
        <line x1={L} y1={B} x2={R} y2={B} stroke="var(--muted-foreground)" strokeOpacity={0.15} />

        <g fontSize={11} className="fill-muted-foreground/60 font-medium">
          <text x={28} y={T + 4} textAnchor="end">100</text>
          <text x={28} y={84} textAnchor="end">66</text>
          <text x={28} y={144} textAnchor="end">33</text>
        </g>

        <g fontSize={11} className="fill-muted-foreground/60 font-medium">
          {dateLabels.map((d, i) => (
            <text
              key={d}
              x={i === dateLabels.length - 1 ? R : toX(d)}
              y={B + 18}
              textAnchor={i === dateLabels.length - 1 ? 'end' : 'start'}
            >
              {new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            </text>
          ))}
        </g>

        {activeSources.map((source) => {
          const points = signals[source];
          const maxVal = Math.max(...points.map((p) => p.value)) || 1;

          return (
            <polyline
              key={source}
              points={points.map((p) => {
                const x = toX(p.date);
                const y = B - (p.value / maxVal) * (B - T);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ')}
              fill="none"
              stroke={SIGNAL_COLORS[source]}
              strokeWidth={2.25}
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
    </section>
  );
}
