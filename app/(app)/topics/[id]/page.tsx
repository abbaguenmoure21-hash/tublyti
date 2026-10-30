import Link from 'next/link';
import { AlertTriangle, Play } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser, requireUser, isDbReady } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { canSeeTopic } from '@/lib/auth/topic-access';
import { PhaseBadge, PHASE_LABELS } from '@/components/tublyti/phase-badge';
import { getMgiBand, type ConfidenceResult } from '@/lib/scoring/mgi';
import { OutlierBadge } from '@/components/tublyti/outlier-badge';
import { GRADE_COLORS } from '@/components/tublyti/feasibility-badge';
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
import { getLatestSnapshots } from '@/lib/youtube/latest-snapshots';
import { COMMENT_LABELS, FRUSTRATION_LABEL, RELIABILITY_LABELS } from '@/lib/lexique';
import { FeasibilityBadge } from '@/components/tublyti/feasibility-badge';
import type { FeasibilityGrade } from '@/lib/scoring/feasibility';

/** Most-liked unanswered-question comments shown (the list is capped: display « 20+ »). */
const FRUSTRATION_LIMIT = 20;

// L'analyse vidéo (Gemini) peut prendre jusqu'à 2-3 minutes.
export const maxDuration = 300;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  // Do not leak a topic label in the tab title to an account that cannot see the topic.
  const user = await getSessionUser();
  if (!user || !(await canSeeTopic(user, id))) return { title: 'Sujet' };
  const db = createServiceClient();
  const { data } = await db.from('topics').select('label').eq('id', id).single();
  return { title: data?.label ? `${data.label} - Dossier` : 'Dossier Sujet' };
}


const COMPETITOR_TAGS: Record<string, { label: string; color: string }> = {
  qualified: { label: 'Vidéo de qualité', color: 'text-muted-foreground' },
  old: { label: 'Ancienne', color: 'text-muted-foreground' },
  off_topic: { label: 'Hors sujet', color: 'text-muted-foreground' },
  short: { label: 'Vidéo courte', color: 'text-muted-foreground' },
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
  if (sec < 60) return 'moins d’1 min';
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

  // Independent reads in parallel (were ~12 sequential round-trips).
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const [saturation, { data: score }, { data: videos, error: videosError }, { data: frustrations, error: frustrationsError }, { data: angles, error: anglesError }, { data: trendPoints }, { data: favoriteTopicIds }, userSubsByNiche] = await Promise.all([
    // Saturation : concurrence récente et performance des nouvelles vidéos du sujet.
    topicSaturation(db, id).catch(() => null),
    // Latest score
    db
      .from('topic_scores')
      .select('mgi, demand, frustration, supply_q, monetization, phase, scored_at, confidence, confidence_reason, feasibility_grade, feasibility_reason, competitor_subs')
      .eq('topic_id', id)
      .order('scored_at', { ascending: false })
      .limit(1)
      .single(),
    // Videos (competitors)
    db
      .from('videos')
      .select('id, title, published_at, duration_s, is_qualified, channel_id, channels(title)')
      .eq('topic_id', id)
      .order('published_at', { ascending: false })
      .limit(20),
    // Frustrated comments
    db
      .from('comment_labels')
      .select(`
      label, requested_angle, confidence,
      comments!inner(id, text, like_count, video_id, videos!inner(topic_id))
    `)
      .eq('comments.videos.topic_id', id)
      .neq('label', 'none')
      .gte('confidence', 0.7)
      .order('comments(like_count)', { ascending: false })
      .limit(FRUSTRATION_LIMIT),
    // Angles
    (async () => {
      let anglesQ = db
        .from('angles')
        .select('id, title, hook, rationale, status, video_id, created_at')
        .eq('topic_id', id)
        .order('created_at', { ascending: false });
      if (await isDbReady()) anglesQ = anglesQ.or(`user_id.is.null,user_id.eq.${user.id}`);
      return anglesQ;
    })(),
    // Signals (90 days)
    db
      .from('trend_points')
      .select('source, captured_at, value')
      .eq('topic_id', id)
      .gte('captured_at', ninetyDaysAgo)
      .order('captured_at', { ascending: true }),
    // Check if topic is in favorites
    getFavoriteIds('topic'),
    // Per-user feasibility
    getUserSubsByNiche(db, user.id),
  ]);

  // Second level: depends on the score and on the video list.
  const videoIds = (videos ?? []).map((v: Record<string, unknown>) => v.id as string);
  const prevDate = score ? new Date(new Date(score.scored_at).getTime() - 7 * 86_400_000).toISOString().slice(0, 10) : null;
  const [prevRes, snaps, outliersRes] = await Promise.all([
    // Previous score (7 days ago) for delta
    prevDate ? db.from('topic_scores').select('mgi').eq('topic_id', id).eq('scored_at', prevDate).single() : Promise.resolve({ data: null }),
    // Get latest views
    getLatestSnapshots(db, videoIds),
    // Fetch outlier scores for these videos
    videoIds.length ? db.from('video_outliers').select('video_id, score, age_days, method, baseline').in('video_id', videoIds) : Promise.resolve({ data: null }),
  ]);

  let mgiDelta: number | null = null;
  const prevScore = prevRes.data as { mgi: number | null } | null;
  if (score && prevScore) mgiDelta = Number(score.mgi) - Number(prevScore.mgi);

  const videoViews: Record<string, number> = {};
  for (const [vid, s] of snaps) videoViews[vid] = s.views ?? 0;

  const videoOutliers: Record<string, { score: number; ageDays: number; method: string; baseline: number }> = {};
  for (const o of (outliersRes.data ?? []) as { video_id: string; score: number; age_days: number; method: string; baseline: number }[]) {
    videoOutliers[o.video_id] = {
      score: Number(o.score),
      ageDays: o.age_days,
      method: o.method,
      baseline: Number(o.baseline),
    };
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

  const signals: Record<string, { date: string; value: number }[]> = {
    trends: [], hn: [], yt_views: [],
  };
  for (const point of trendPoints ?? []) {
    const source = point.source as string;
    if (source in signals) {
      signals[source].push({ date: point.captured_at, value: point.value });
    }
  }

  const isFavorite = favoriteTopicIds.includes(id);

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
          <div role="status" className="flex items-center gap-2 rounded-[10px] bg-warning/10 px-4 py-2.5 text-[13px] text-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
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
            <div className="flex flex-col gap-1.5 rounded-xl bg-card px-4 py-4">
              <span className="text-[13px] font-medium text-muted-foreground">Potentiel</span>
              <span className="flex items-baseline gap-2">
                <span className="text-[30px] font-semibold leading-none tabular-nums tracking-[-0.02em]">{Math.round(mgiVal)}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
                {mgiDelta !== null && Math.round(mgiDelta) !== 0 && (
                  <span className={`text-[13px] font-medium ${mgiDelta >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {mgiDelta >= 0 ? '+' : ''}{Math.round(mgiDelta)} en 7 j
                  </span>
                )}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(mgiVal, 100)}%` }} />
              </span>
              <span className="text-xs text-muted-foreground" title={confidenceData?.reason}>
                {confidenceData ? (RELIABILITY_LABELS[confidenceData.level as 'high' | 'medium' | 'low'] ?? RELIABILITY_LABELS.low) : ''}
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
              label={FRUSTRATION_LABEL}
              value={`${Math.round(Number(score.frustration) * 100)}`}
              unit="%"
              sub="des commentaires analysés sur ce sujet"
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
            <section className="rounded-xl bg-card overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
                <h2 className="text-headline">Ce que réclame le public</h2>
                <span className="text-[13px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
                  {totalFrustrated >= FRUSTRATION_LIMIT ? `${FRUSTRATION_LIMIT}+` : totalFrustrated} commentaire{totalFrustrated !== 1 ? 's' : ''}
                </span>
              </div>
              {frustrationList.length === 0 ? (
                <div className="px-5 py-10 text-center text-[14px] text-muted-foreground font-medium">
                  Aucune question du public repérée pour l’instant sur ce sujet.
                </div>
              ) : (
                frustrationList.slice(0, 8).map((f) => (
                  <div key={f.commentId} className="px-5 py-4 border-b border-border flex flex-col gap-2.5 last:border-0 hover:bg-muted/40 transition-colors">
                    <p className="line-clamp-4 text-[15px] leading-relaxed text-foreground">« {f.text} »</p>
                    <div className="flex flex-wrap items-center gap-2.5 text-[12px] text-muted-foreground">
                      <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-muted px-2 font-medium text-muted-foreground">
                        {COMMENT_LABELS[f.label] ?? f.label}
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
            <section className="rounded-xl bg-card overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-border bg-muted/40">
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
                    <div key={c.id} className="px-5 py-3.5 border-b border-border flex gap-3.5 items-center last:border-0 hover:bg-muted transition-colors">
                      <a href={`https://youtube.com/watch?v=${c.id}`} target="_blank" rel="noopener noreferrer" className="shrink-0 relative group">
                        <img 
                          src={`https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`} 
                          alt={c.title} 
                          className="elev-1 aspect-video w-[80px] rounded-lg object-cover"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <Play className="h-4 w-4 fill-current text-white" aria-hidden="true" />
                        </div>
                      </a>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <a href={`https://youtube.com/watch?v=${c.id}`} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground hover:text-primary">
                          {c.title}
                        </a>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted-foreground">
                          <a href={`https://youtube.com/channel/${c.channelId}`} target="_blank" rel="noopener noreferrer" className="hover:underline truncate max-w-[160px]">
                            {c.channelTitle}
                          </a>
                          <span>·</span>
                          <span className="shrink-0 tabular-nums">{formatViews(c.views)} vues</span>
                          <span className="shrink-0">· {formatRelativeDate(c.publishedAt)} · {formatDuration(c.durationSec)}</span>
                        </div>
                      </div>
                      {/* Actions under the text (the column is ≤ 400 px wide): the title keeps the full width. */}
                      <div className="flex basis-full flex-wrap items-center gap-2 pl-[92px]">
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
    <div className="flex flex-col gap-1.5 rounded-xl bg-card px-4 py-4">
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-[30px] font-semibold leading-none tabular-nums tracking-[-0.02em]">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </span>
      {sub && <span className="text-xs leading-snug text-muted-foreground">{sub}</span>}
    </div>
  );
}

// Palette catégorielle des sources (DESIGN.md), distincte des couleurs de phase.
const SIGNAL_COLORS: Record<string, string> = {
  trends: 'var(--chart-1)',
  yt_views: 'var(--chart-2)',
  hn: 'var(--chart-3)',
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
    <section className="rounded-xl bg-card px-5 py-4 flex flex-col gap-3">
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
        <g stroke="var(--border)" strokeDasharray="3 4">
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
