import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser, isDbReady } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { PhaseBadge, MgiScore, PHASE_LABELS } from '@/components/tublyti';
import { getMgiBand, type ConfidenceResult } from '@/lib/scoring/mgi';
import { OutlierBadge } from '@/components/tublyti/outlier-badge';
import { AnalyzeVideoButton } from '@/components/tublyti/video-analysis';
import { TopicSaturationCard, OutlierSaturationButton } from '@/components/tublyti/saturation';
import { topicSaturation } from '@/lib/saturation';
import { TopicActions } from './_components/topic-actions';
import { AngleSection } from './_components/angle-section';
import type { BriefData } from './_components/brief';
import { DossierExport } from './_components/dossier-export';
import { getFavoriteIds } from '@/lib/actions/collections';
import { computeFeasibilityForUser, isNoChannelResult } from '@/lib/scoring/feasibility-for-user';
import { getUserSubsByNiche } from '@/lib/scoring/user-subs';
import { FeasibilityBadge } from '@/components/tublyti/feasibility-badge';
import type { FeasibilityGrade } from '@/lib/scoring/feasibility';

// L'analyse vidéo (Gemini) peut prendre jusqu'à 2-3 minutes.
export const maxDuration = 300;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const db = createServiceClient();
  const { data } = await db.from('topics').select('label').eq('id', id).single();
  return { title: data?.label ? `${data.label} - Dossier` : 'Dossier Sujet' };
}

const LABEL_NAMES: Record<string, string> = {
  no_one_explains: 'Explication manquante',
  wish_video_on: 'Vidéo réclamée',
  stopped_too_early: 'Sujet survolé',
  searched_long: 'Recherche difficile',
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
    // Accès : toutes les chaînes vérifiées du client (pas seulement celle affichée).
    const { niches: mine } = await resolveScope(db, user.id);
    const topicNiche = (topic.niches as unknown as { id: string } | null)?.id;
    if (!topicNiche || !mine.some((n) => n.id === topicNiche)) notFound();
  }

  // Saturation : concurrence récente et performance des nouvelles vidéos du sujet.
  const saturation = await topicSaturation(db, id).catch(() => null);

  // Latest score
  const { data: score } = await db
    .from('topic_scores')
    .select('mgi, demand, frustration, supply_q, monetization, phase, scored_at, confidence, confidence_reason, feasibility_grade, feasibility_reason, competitor_subs')
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
  const { data: videos, error: videosError } = await db
    .from('videos')
    .select('id, title, published_at, duration_s, is_qualified, channel_id, channels(title)')
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
    const durationSec = (v.duration_s as number) ?? 0;
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
  const { data: frustrations, error: frustrationsError } = await db
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
  const { data: angles, error: anglesError } = await anglesQ;
  // A failed query must show the error state, not empty sections (« Aucune vidéo trouvée »).
  if (videosError || frustrationsError || anglesError) {
    throw new Error(`topic page load failed: ${(videosError ?? frustrationsError ?? anglesError)?.message}`);
  }

  // Per-account state (the shared topics.status is not per user since multi-account).
  const ready = await isDbReady();
  let myVideos: { status: string }[] = [];
  if (ready) {
    const { data: mineRows } = await db.from('angles').select('status').eq('topic_id', id).eq('user_id', user.id);
    myVideos = (mineRows ?? []) as { status: string }[];
  }
  const inMyVideos = ready ? myVideos.length > 0 : topic.status === 'in_production';
  const hasOpenVideo = ready ? myVideos.some((v) => v.status === 'in_production') : topic.status === 'in_production';

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

  // Per-user feasibility
  const userSubsByNiche = await getUserSubsByNiche(db, user.id);
  const topicNicheId = (topic.niches as unknown as { id: string } | null)?.id;
  const userSubs = topicNicheId ? (userSubsByNiche.get(topicNicheId) ?? null) : null;
  const competitorSubs = (score as Record<string, unknown> | null)?.competitor_subs as number[] | null ?? null;
  const userFeasibility = userSubs != null
    ? computeFeasibilityForUser(userSubs, competitorSubs)
    : null;
  const showFeasibility = userFeasibility && !isNoChannelResult(userFeasibility);
  const showNoChannelHint = userSubs == null;

  const phase = score?.phase ?? topic.phase;
  const niche = topic.niches as unknown as {
    id: string; name: string; rpm_coefficient: number;
    rpm_low: number | null; rpm_high: number | null; rpm_source: string | null;
  } | null;

  const daysSinceCreated = Math.floor(
    (Date.now() - new Date(topic.created_at).getTime()) / 86_400_000,
  );

  const totalFrustrated = frustrationList.length;

  const briefData: BriefData = {
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
      label: f.label,
      requestedAngle: f.requestedAngle,
      commentId: f.commentId,
    })),
    competitors: competitors.map((c) => ({
      title: c.title,
      channelTitle: c.channelTitle,
      views: c.views,
      videoId: c.id,
    })),
  };
  // Brief angle: the one already chosen, otherwise the first proposed one.
  const anglesList = (angles ?? []) as { id: string; title: string | null; hook: string | null; rationale: string | null; status: string }[];
  const chosenAngle =
    anglesList.find((a) => a.status === 'in_production' || a.status === 'published') ?? anglesList[0] ?? null;
  const briefAngle = chosenAngle
    ? { id: chosenAngle.id as string, title: String(chosenAngle.title ?? ''), hook: String(chosenAngle.hook ?? ''), rationale: String(chosenAngle.rationale ?? '') }
    : null;

  // Estimate total comments from frustration ratio
  let totalComments = 0;
  if (score && Number(score.frustration) > 0) {
    totalComments = Math.round(totalFrustrated / Number(score.frustration));
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Retour : un seul niveau, comme dans les apps Apple */}
      <nav aria-label="Retour" className="px-4 pt-5 md:px-8">
        <Link href={`/sujets?sujet=${id}&moment=tous`} className="inline-flex items-center gap-1 text-[15px] font-medium text-primary">
          <span aria-hidden="true">‹</span> Sujets
        </Link>
      </nav>

      <div className="flex flex-1 flex-col gap-5 px-4 pb-12 pt-3 md:px-8">
        {/* Title row */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="flex min-w-0 flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <PhaseBadge phase={phase} />
              <span className="text-[13px] text-muted-foreground">
                {niche?.name ? `${niche.name} · ` : ''}repéré il y a {daysSinceCreated} jour{daysSinceCreated !== 1 ? 's' : ''}
              </span>
            </div>
            <h1 className="break-words text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">
              {topic.label}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
            <DossierExport topicId={id} />
            <TopicActions
              topicId={id}
              topicLabel={topic.label}
              inMyVideos={inMyVideos}
              hasOpenVideo={hasOpenVideo}
              isFavorite={isFavorite}
              canGenerate={user.role === 'admin'}
              briefAngle={briefAngle}
              briefData={briefData}
            />
          </div>
        </div>

        {/* Stale data banner */}
        {score && (Date.now() - new Date(score.scored_at).getTime() > 36 * 3_600_000) && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] bg-[var(--warning)]/10 text-[var(--warning)] text-[13px] border border-[var(--warning)]/20">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Ces chiffres datent de plus de 36 heures : la mise à jour de cette nuit n’est pas encore passée.
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="flex flex-col gap-1.5 rounded-2xl bg-card px-4 py-4">
              <span className="text-[13px] font-medium text-muted-foreground">Potentiel</span>
              <span className="flex items-baseline gap-2">
                <span className="text-[30px] font-semibold leading-none tabular-nums tracking-[-0.02em]">{Math.round(mgiVal)}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
                {mgiDelta !== null && Math.round(mgiDelta) !== 0 && (
                  <span className={`text-[13px] font-medium ${mgiDelta >= 0 ? 'text-phase-2-ink' : 'text-phase-3-ink'}`}>
                    {mgiDelta >= 0 ? '+' : ''}{Math.round(mgiDelta)} en 7 j
                  </span>
                )}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(mgiVal, 100)}%` }} />
              </span>
              <span className="text-xs text-muted-foreground" title={confidenceData?.reason}>
                {confidenceData ? (confidenceData.level === 'high' ? 'Fiable' : confidenceData.level === 'medium' ? 'Assez fiable' : 'Peu de données') : ''}
                {confidenceData ? ' · ' : ''}
                {formatScoredAtFreshness(score.scored_at)}
              </span>
            </div>
            <ScoreCard label="Demande du public" value={`${Math.round(Number(score.demand) * 100)}`} unit="/ 100" sub="Comparée aux autres sujets de la thématique" />
            <ScoreCard
              label="Bonnes vidéos existantes"
              value={Number(score.supply_q) <= 0 ? 'Aucune' : `×${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(Number(score.supply_q))}`}
              sub={Number(score.supply_q) < 0.8 ? 'Moins que la moyenne : peu de concurrence' : Number(score.supply_q) <= 1.25 ? 'Dans la moyenne de la thématique' : 'Plus que la moyenne : concurrence forte'}
            />
            <ScoreCard
              label="Public frustré"
              value={`${Math.round(Number(score.frustration) * 100)}`}
              unit="%"
              sub={totalComments > 0 ? `des ${totalComments.toLocaleString('fr-FR')} commentaires analysés` : 'des commentaires analysés'}
            />
            <ScoreCard
              label="Revenus publicitaires"
              value={niche?.rpm_low && niche?.rpm_high ? `${niche.rpm_low} à ${niche.rpm_high} $` : `×${Number(score.monetization).toFixed(1)}`}
              sub={niche?.rpm_low && niche?.rpm_high ? 'pour 1 000 vues (estimation de la thématique)' : 'par rapport à une thématique moyenne'}
            />
          </div>
          );
        })()}

        {/* Feasibility card */}
        {showFeasibility && (
          <div className="flex items-center gap-3 rounded-xl bg-card px-[18px] py-3.5">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold">Tes chances</span>
              <FeasibilityBadge grade={userFeasibility.grade as FeasibilityGrade} showLabel />
              <span className="text-[13px] text-muted-foreground">{userFeasibility.reason}</span>
              <Link href="/guide#faisabilite" className="text-[12px] font-medium text-primary hover:underline">Comment c’est calculé</Link>
            </div>
          </div>
        )}
        {showNoChannelHint && (
          <div className="flex items-center gap-3 rounded-xl bg-card px-[18px] py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold">Tes chances</span>
              <span className="text-[13px] text-muted-foreground">
                <Link href="/settings#chaines" className="text-primary hover:underline">Ajoute l’adresse YouTube de ta chaîne dans Réglages</Link> pour voir tes chances.
              </span>
            </div>
          </div>
        )}

        {saturation && <TopicSaturationCard s={saturation} />}

        {/* Two-column layout */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-4">
          {/* Left column */}
          <div className="flex-1 min-w-0 flex flex-col gap-5">
            <SignalSection signals={signals} />

            {/* Frustrations */}
            <section className="bento-card !p-0 flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[--glass-border] bg-[--bg-surface-1]/50">
                <h2 className="text-headline">Ce que réclame le public</h2>
                <span className="text-[13px] font-medium text-muted-foreground bg-[--bg-surface-2] px-2 py-0.5 rounded border border-[--glass-border]">
                  {totalFrustrated} commentaire{totalFrustrated !== 1 ? 's' : ''}
                </span>
              </div>
              {frustrationList.length === 0 ? (
                <div className="px-5 py-10 text-center text-[14px] text-muted-foreground font-medium">
                  Aucun commentaire de frustration détecté.
                </div>
              ) : (
                frustrationList.slice(0, 8).map((f) => (
                  <div key={f.commentId} className="px-5 py-4 border-b border-[--glass-border] flex flex-col gap-2.5 last:border-0 hover:bg-[--bg-surface-1]/30 transition-colors">
                    <p className="line-clamp-4 text-[15px] leading-relaxed text-foreground">« {f.text} »</p>
                    <div className="flex flex-wrap items-center gap-2.5 text-[12px] text-muted-foreground">
                      <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-muted px-2 font-medium text-muted-foreground">
                        {LABEL_NAMES[f.label] ?? f.label}
                      </span>
                      {f.requestedAngle && (
                        <span>
                          Angle demandé : <span className="font-semibold text-primary">{f.requestedAngle}</span>
                        </span>
                      )}
                      <span className="ml-auto shrink-0 tabular-nums font-medium">{formatLikes(f.likeCount)} like{f.likeCount > 1 ? 's' : ''}</span>
                    </div>
                  </div>
                ))
              )}
              {frustrationList.length > 8 && (
                <p className="px-5 py-3 text-[13px] text-muted-foreground">
                  Et {frustrationList.length - 8} autre{frustrationList.length - 8 > 1 ? 's' : ''} commentaire{frustrationList.length - 8 > 1 ? 's' : ''} : ils sont tous dans le résumé copié et dans l’export.
                </p>
              )}
            </section>
          </div>

          {/* Right column */}
          <div className="flex w-full min-w-0 flex-col gap-5 lg:w-[400px] lg:shrink-0">
            <AngleSection
              topicId={id}
              angles={angles ?? []}
              canGenerate={user.role === 'admin'}
              briefData={briefData}
            />

            {/* Competitors */}
            <section className="bento-card !p-0 flex flex-col">
              <div className="px-5 py-4 border-b border-[--glass-border] bg-[--bg-surface-1]/50">
                <h2 className="text-headline">Vidéos déjà publiées sur ce sujet</h2>
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
                          className="elev-1 aspect-video w-[96px] rounded-lg object-cover"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 5V19L19 12L8 5Z" />
                          </svg>
                        </div>
                      </a>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <a href={`https://youtube.com/watch?v=${c.id}`} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground hover:text-primary">
                          {c.title}
                        </a>
                        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                            <a href={`https://youtube.com/channel/${c.channelId}`} target="_blank" rel="noopener noreferrer" className="hover:underline truncate max-w-[120px]">
                            {c.channelTitle}
                          </a>
                          <span>·</span>
                          <span className="shrink-0 tabular-nums">{formatViews(c.views)} vues</span>
                          <span className="shrink-0">· {formatRelativeDate(c.publishedAt)} · {formatDuration(c.durationSec)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <AnalyzeVideoButton videoId={c.id} title={c.title} variant="icon" />
                        {c.outlier && c.outlier.score >= 2 && <OutlierSaturationButton videoId={c.id} />}
                        {c.outlier && c.outlier.score >= 2 && (
                          <OutlierBadge
                            score={c.outlier.score}
                            ageDays={c.outlier.ageDays}
                            method={c.outlier.method}
                            baseline={c.outlier.baseline}
                          />
                        )}
                        {c.tag !== 'qualified' && (
                          <span className={`rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium ${tagInfo.color}`}>{tagInfo.label}</span>
                        )}
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

function ScoreCard({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl bg-card px-4 py-4">
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[30px] font-semibold leading-none tabular-nums tracking-[-0.02em]">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </span>
      {sub && <span className="text-xs leading-snug text-muted-foreground">{sub}</span>}
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
  // Une courbe a besoin d'au moins 3 points : sinon on n'affiche rien plutôt qu'un graphique vide.
  const activeSources = Object.keys(signals).filter((s) => signals[s].length >= 3);

  if (activeSources.length === 0) return null;

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-headline">Signaux sur 90 jours</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
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
