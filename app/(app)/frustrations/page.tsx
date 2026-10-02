import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';

export const metadata = { title: 'Frustrations' };
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MessageSquareWarning, AlertTriangle, ThumbsUp, TrendingUp, Lightbulb, Target, Clock, Search, PlaySquare } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { LabelCorrector } from './_components/label-corrector';
import { NicheFilter } from './_components/niche-filter';
import { OutlierBadge } from '@/components/tublyti/outlier-badge';

/* ------------------------------------------------------------------ */
/*  Types & constants                                                  */
/* ------------------------------------------------------------------ */

interface FrustrationItem {
  commentId: string;
  label: string;
  requestedAngle: string | null;
  confidence: number;
  model: string;
  commentText: string;
  likeCount: number;
  videoId: string;
  videoTitle: string;
  channelTitle: string;
  nicheName: string;
}

const LABEL_NAMES: Record<string, string> = {
  no_one_explains: 'Personne ne traite',
  wish_video_on: 'Souhait de vidéo',
  stopped_too_early: 'Trop court',
  searched_long: 'Longue recherche',
  none: 'Aucun',
};

function LabelBadge({ label }: { label: string }) {
  const name = LABEL_NAMES[label] ?? label;

  const LABEL_CLASSES: Record<string, string> = {
    no_one_explains: 'bg-phase-3-soft text-phase-3-ink',
    wish_video_on: 'bg-primary-soft text-primary-ink',
    stopped_too_early: 'bg-phase-1-soft text-phase-1-ink',
    searched_long: 'bg-phase-0-soft text-phase-0-ink',
  };

  const classes = LABEL_CLASSES[label];
  if (classes) {
    return <Badge className={classes}>{name}</Badge>;
  }
  return <Badge variant="secondary">{name}</Badge>;
}

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */

async function getFrustrations(): Promise<FrustrationItem[]> {
  const db = createServiceClient();

  const { data, error } = await db
    .from('comment_labels')
    .select(
      `
      comment_id,
      label,
      requested_angle,
      confidence,
      model,
      labeled_at,
      comments!inner (
        id,
        text,
        like_count,
        published_at,
        video_id,
        videos!inner (
          id,
          title,
          channel_id,
          channels!inner (
            title,
            niche_id,
            niches!inner ( name )
          )
        )
      )
    `,
    )
    .neq('label', 'none')
    .order('labeled_at', { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(error.message);
  }

  const items: FrustrationItem[] = (data ?? []).map(
    (row: Record<string, unknown>) => {
      const comment = row.comments as Record<string, unknown>;
      const video = comment.videos as Record<string, unknown>;
      const channel = video.channels as Record<string, unknown>;
      const niche = channel.niches as Record<string, unknown>;

      return {
        commentId: row.comment_id as string,
        label: row.label as string,
        requestedAngle: (row.requested_angle as string) ?? null,
        confidence: row.confidence as number,
        model: row.model as string,
        commentText: comment.text as string,
        likeCount: (comment.like_count as number) ?? 0,
        videoId: video.id as string,
        videoTitle: video.title as string,
        channelTitle: channel.title as string,
        nicheName: niche.name as string,
      };
    },
  );

  items.sort((a, b) => b.likeCount - a.likeCount);

  return items;
}

/* ------------------------------------------------------------------ */
/*  Outlier types & fetch                                              */
/* ------------------------------------------------------------------ */

interface OutlierVideo {
  videoId: string;
  videoTitle: string;
  channelId: string;
  channelTitle: string;
  subscriberCount: number;
  score: number;
  baseline: number;
  ageDays: number;
  method: 'same_age' | 'approximate';
  views: number;
  thumbnailUrl: string | null;
  nicheName: string;
}

async function getSmallChannelOutliers(filterNiche: string): Promise<OutlierVideo[]> {
  const db = createServiceClient();

  let query = db
    .from('video_outliers')
    .select(`
      video_id, score, baseline, age_days, method,
      videos!inner (
        id, title, thumbnail_url,
        channels!inner (
          id, title, subscriber_count,
          niches!inner (
            name
          )
        )
      )
    `)
    .gte('score', 1.5)
    .lte('videos.channels.subscriber_count', 50000)
    .lte('age_days', 365); // Filter out old videos (>1 year)
    
  if (filterNiche) {
    query = query.eq('videos.channels.niches.name', filterNiche);
  }

  const { data, error } = await query
    .order('score', { ascending: false })
    .limit(300);

  if (error) return [];

  const items: OutlierVideo[] = [];
  for (const row of data ?? []) {
    const video = row.videos as unknown as {
      id: string; title: string; thumbnail_url: string | null;
      channels: { 
        id: string; title: string; subscriber_count: number | null;
        niches: { name: string };
      };
    };
    const subs = video.channels?.subscriber_count ?? 0;
    if (subs > 50_000) continue; // safety check

    // Get latest views for this video
    const { data: snaps } = await db
      .from('video_snapshots')
      .select('views')
      .eq('video_id', row.video_id)
      .order('captured_at', { ascending: false })
      .limit(1);

    items.push({
      videoId: row.video_id as string,
      videoTitle: video.title,
      channelId: video.channels.id,
      channelTitle: video.channels.title,
      subscriberCount: subs,
      score: Number(row.score),
      baseline: Number(row.baseline),
      ageDays: row.age_days as number,
      method: row.method as 'same_age' | 'approximate',
      views: snaps?.[0]?.views ?? 0,
      thumbnailUrl: video.thumbnail_url,
      nicheName: video.channels.niches.name,
    });
  }

  return items.slice(0, 30);
}

function formatSubs(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return String(n);
}

function formatOutlierViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return String(n);
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function FrustrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filterNiche =
    typeof params.niche === 'string' ? params.niche : '';
  const tab = typeof params.tab === 'string' ? params.tab : 'frustrations';

  let items: FrustrationItem[];
  let fetchError: string | null = null;
  let outlierVideos: OutlierVideo[] = [];
  let allNicheNames: string[] = [];

  try {
    const db = createServiceClient();
    const [frustrationItems, outliers, { data: nichesData }] = await Promise.all([
      getFrustrations(),
      getSmallChannelOutliers(filterNiche),
      db.from('niches').select('name').order('name'),
    ]);
    items = frustrationItems;
    outlierVideos = outliers;
    
    // We combine niches from the database and the currently fetched items just in case
    const dbNiches = nichesData ? nichesData.map((n: { name: string }) => n.name) : [];
    const itemNiches = items.map((i) => i.nicheName);
    allNicheNames = [...new Set([...dbNiches, ...itemNiches])].sort();
    
  } catch (err) {
    items = [];
    fetchError =
      err instanceof Error ? err.message : 'Erreur inconnue';
  }

  /* ---------------------------------------------------------------- */
  /*  Error state                                                      */
  /* ---------------------------------------------------------------- */
  if (fetchError) {
    return (
      <div className="flex-1 flex flex-col min-h-full relative overflow-x-clip">
        <div className="absolute inset-0 pointer-events-none -z-10">
          <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/15 dark:bg-blue-600/15 blur-[100px]" />
        </div>
        <div className="flex-1 p-6 md:px-12 md:py-10 flex flex-col gap-8 w-full max-w-[1400px] mx-auto">
          <h1 className="text-title-1 leading-tight">Que réclament les spectateurs ?</h1>
          <div className="bento-card !py-16 flex flex-col items-center justify-center text-center">
            <AlertTriangle className="size-10 text-destructive mb-4" />
            <p className="text-[15px] font-semibold text-destructive">
              {fetchError}
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Vérifiez votre connexion et rechargez la page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Empty state                                                      */
  /* ---------------------------------------------------------------- */
  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-full relative overflow-x-clip">
        <div className="absolute inset-0 pointer-events-none -z-10">
          <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/15 dark:bg-blue-600/15 blur-[100px]" />
        </div>
        <div className="flex-1 p-6 md:px-12 md:py-10 flex flex-col gap-8 w-full max-w-[1400px] mx-auto">
          <h1 className="text-title-1 leading-tight">Que réclament les spectateurs ?</h1>
          <div className="bento-card !py-16 flex flex-col items-center justify-center text-center">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-5 shadow-[0_2px_8px_rgba(10,132,255,0.15)]">
              <MessageSquareWarning className="size-7" />
            </div>
            <p className="text-title-3 mb-2">
              Aucune frustration détectée pour l&apos;instant
            </p>
            <p className="text-[14px] text-muted-foreground max-w-md">
              TubLyTI analyse les commentaires YouTube pour détecter les besoins
              non satisfaits des spectateurs.
            </p>
            <p className="text-[13px] text-muted-foreground mt-3">
              Les frustrations apparaîtront automatiquement après la prochaine
              collecte et classification.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Filter & group by Label                                          */
  /* ---------------------------------------------------------------- */
  const filtered = filterNiche
    ? items.filter((i) => i.nicheName === filterNiche)
    : items;

  // Group by NLP Label
  const groupedByLabel = new Map<string, FrustrationItem[]>();
  for (const item of filtered) {
    if (!groupedByLabel.has(item.label)) groupedByLabel.set(item.label, []);
    groupedByLabel.get(item.label)!.push(item);
  }

  const LABEL_GROUPS = [
    {
      id: 'wish_video_on',
      title: 'Idées réclamées (Souhaits)',
      description: 'Les spectateurs demandent explicitement une vidéo sur ce sujet. Créez-la pour répondre à une demande directe.',
      icon: Lightbulb,
      colorClass: 'text-primary'
    },
    {
      id: 'no_one_explains',
      title: 'Trous dans le marché',
      description: 'Personne n\'explique ce concept clairement. C\'est une excellente opportunité pour vous positionner en expert.',
      icon: Target,
      colorClass: 'text-purple-500 dark:text-purple-400'
    },
    {
      id: 'stopped_too_early',
      title: 'Sujets survolés (Trop court)',
      description: 'Le créateur est passé trop vite sur un point. Faites une vidéo dédiée pour approfondir ce que l\'audience veut vraiment savoir.',
      icon: Clock,
      colorClass: 'text-orange-500 dark:text-orange-400'
    },
    {
      id: 'searched_long',
      title: 'Longues recherches (SEO)',
      description: 'Les spectateurs ont cherché longtemps avant de trouver. Utilisez ces termes exacts dans vos titres pour capter le trafic de recherche.',
      icon: Search,
      colorClass: 'text-emerald-500 dark:text-emerald-400'
    }
  ];

  /* ---------------------------------------------------------------- */
  /*  Main content                                                     */
  /* ---------------------------------------------------------------- */
  return (
    <div className="flex-1 flex flex-col min-h-full relative overflow-x-clip">
      {/* Background gradients multi-niveaux */}
      <div className="absolute inset-0 pointer-events-none -z-10">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-400/15 dark:bg-blue-600/15 blur-[100px]" />
        <div className="absolute top-[20%] -right-[10%] w-[40%] h-[60%] rounded-full bg-purple-400/15 dark:bg-purple-600/15 blur-[120px]" />
        <div className="absolute -bottom-[20%] left-[20%] w-[60%] h-[50%] rounded-full bg-cyan-400/15 dark:bg-cyan-600/15 blur-[100px]" />
      </div>

      <div className="flex-1 p-6 md:px-12 md:py-10 flex flex-col gap-8 overflow-x-hidden w-full max-w-[1400px] mx-auto">
        {/* Page header */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] font-bold tracking-tight text-foreground leading-tight">Que réclament les spectateurs ?</h1>
            <p className="text-[16px] font-medium text-muted-foreground/80">
              Commentaires qui expriment un besoin non satisfait
            </p>
          </div>

          <div className="flex items-center gap-3 mt-2 sm:mt-0">
            <Badge variant="secondary">
              {filtered.length} commentaire{filtered.length > 1 ? 's' : ''}
            </Badge>
            <NicheFilter niches={allNicheNames} />
          </div>
        </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-black/5 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5 shadow-inner w-fit">
        <a
          href="/frustrations"
          className={`h-[36px] px-4 rounded-[12px] text-[13px] transition-all flex items-center gap-2 cursor-pointer ${
            tab !== 'outliers'
              ? 'bg-white dark:bg-[#1C1C1E] text-foreground font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-black/5 dark:border-white/10'
              : 'text-muted-foreground font-medium hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
          }`}
        >
          <MessageSquareWarning className="w-[15px] h-[15px]" />
          Frustrations
        </a>
        <a
          href="/frustrations?tab=outliers"
          className={`h-[36px] px-4 rounded-[12px] text-[13px] transition-all flex items-center gap-2 cursor-pointer ${
            tab === 'outliers'
              ? 'bg-white dark:bg-[#1C1C1E] text-foreground font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-black/5 dark:border-white/10'
              : 'text-muted-foreground font-medium hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
          }`}
        >
          <TrendingUp className="w-[15px] h-[15px]" />
          Outliers petites chaînes
          {outlierVideos.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-[11px] h-5 rounded-md px-1.5">{outlierVideos.length}</Badge>
          )}
        </a>
      </div>

      {/* Outliers tab content */}
      {tab === 'outliers' && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <p className="text-[15px] font-medium text-muted-foreground">
              Vidéos de chaînes <strong className="text-foreground font-bold">≤ 50 k abonnés</strong> qui surperforment la moyenne de leur chaîne. (Publiées il y a moins d'un an)
            </p>
          </div>
          {outlierVideos.length === 0 ? (
            <div className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-sm rounded-[24px] py-16 flex flex-col items-center justify-center text-center gap-3">
              <Search className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-[15px] text-muted-foreground font-medium">
                Aucun outlier de petite chaîne détecté récemment.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {outlierVideos.map((v) => (
                <a
                  key={v.videoId}
                  href={`https://www.youtube.com/watch?v=${v.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-black/5 dark:border-white/10 rounded-[24px] overflow-hidden shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 transition-all"
                >
                  <div className="relative aspect-video w-full bg-black/5 dark:bg-white/5 overflow-hidden">
                    {v.thumbnailUrl ? (
                      <img src={v.thumbnailUrl} alt={v.videoTitle} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <PlaySquare className="w-8 h-8 opacity-20" />
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <OutlierBadge score={v.score} ageDays={v.ageDays} method={v.method} baseline={v.baseline} />
                    </div>
                  </div>
                  
                  <div className="p-5 flex flex-col gap-4 flex-1">
                    <div>
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">{v.nicheName}</p>
                      <h3 className="text-[15px] font-bold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                        {v.videoTitle}
                      </h3>
                    </div>
                    
                    <div className="flex items-center gap-3 mt-auto pt-2 border-t border-black/5 dark:border-white/10">
                      <Avatar className="w-[34px] h-[34px] ring-2 ring-background shadow-sm">
                        <AvatarImage src={`https://unavatar.io/youtube/${v.channelId}`} alt={v.channelTitle} />
                        <AvatarFallback className="bg-black/5 dark:bg-white/10 font-bold text-xs">{v.channelTitle.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[13px] font-bold text-foreground truncate">{v.channelTitle}</span>
                        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground font-medium">
                          <span>{formatOutlierViews(v.views)} vues</span>
                          <span className="opacity-40">•</span>
                          <span>{formatSubs(v.subscriberCount)} abo</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Frustrations tab content */}
      {tab !== 'outliers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
          {LABEL_GROUPS.map((group) => {
            const groupItems = groupedByLabel.get(group.id) || [];
            if (groupItems.length === 0) return null;
            
            const Icon = group.icon;

            return (
              <Dialog key={group.id}>
                <DialogTrigger render={<button type="button" className="w-full cursor-pointer group flex flex-col gap-3 bg-white/40 dark:bg-white/5 backdrop-blur-xl border border-black/5 dark:border-white/10 rounded-[28px] p-6 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:bg-white/60 dark:hover:bg-white/10 transition-all text-left" />}>
                  <div className="flex justify-between items-start">
                      <div className={`p-3 rounded-2xl bg-white dark:bg-black/20 shadow-sm border border-black/5 dark:border-white/10 ${group.colorClass}`}>
                        <Icon className="w-7 h-7" />
                      </div>
                      <Badge variant="secondary" className="rounded-full px-3 py-1 bg-black/5 dark:bg-white/10 font-bold text-[14px]">
                        {groupItems.length}
                      </Badge>
                    </div>
                    <div className="mt-2">
                      <h2 className="text-[22px] font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
                        {group.title}
                      </h2>
                      <p className="text-muted-foreground text-[15px] mt-1.5 leading-relaxed">
                        {group.description}
                      </p>
                    </div>
                </DialogTrigger>

                <DialogContent className="w-full sm:max-w-[1000px] h-[85vh] flex flex-col gap-0 p-0 overflow-hidden bg-background/95 backdrop-blur-3xl border border-glass rounded-[32px] shadow-2xl">
                  <DialogHeader className="p-6 md:p-8 border-b border-black/5 dark:border-white/10 bg-black/5 dark:bg-white/5 shrink-0">
                    <DialogTitle className="flex flex-col gap-1 text-left">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl bg-background shadow-sm border border-black/5 dark:border-white/10 ${group.colorClass}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <span className="text-[24px] font-bold text-foreground">{group.title}</span>
                        <Badge variant="secondary" className="ml-1 rounded-full px-2.5 py-0.5 bg-black/5 dark:bg-white/10 font-bold">
                          {groupItems.length}
                        </Badge>
                      </div>
                      <p className="text-[14px] text-muted-foreground mt-2">{group.description}</p>
                    </DialogTitle>
                  </DialogHeader>

                  <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-black/5 dark:bg-transparent">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      {groupItems.map((item) => (
                        <div
                          key={item.commentId}
                          className="bg-white/80 dark:bg-white/5 backdrop-blur-2xl border border-black/5 dark:border-white/10 shadow-sm rounded-[24px] transition-all hover:shadow-md flex flex-col"
                        >
                          <div className="p-6 flex flex-col h-full">
                            {/* Video context */}
                            <div className="mb-4 pb-4 border-b border-black/5 dark:border-white/10">
                              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">{item.nicheName}</p>
                              <a 
                                href={`https://www.youtube.com/watch?v=${item.videoId}`}
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-[15px] font-semibold text-foreground hover:text-primary transition-colors line-clamp-2 leading-snug"
                              >
                                {item.videoTitle}
                              </a>
                              <p className="text-[13px] text-muted-foreground mt-1.5">sur <span className="font-medium text-foreground/80">{item.channelTitle}</span></p>
                            </div>

                            {/* Comment text */}
                            <div className="flex-1 min-w-0 mb-5">
                              <p className="text-[15px] font-medium text-foreground whitespace-pre-wrap break-words leading-relaxed italic border-l-[3px] border-primary/30 pl-4 py-1">
                                "{item.commentText}"
                              </p>
                              {item.requestedAngle && (
                                <div className="mt-5 bg-primary/5 border border-primary/10 rounded-2xl p-4">
                                  <p className="text-[11px] font-bold text-primary/70 uppercase tracking-widest mb-1.5">Angle suggéré</p>
                                  <p className="text-[15px] font-semibold text-primary-ink leading-snug">
                                    {item.requestedAngle}
                                  </p>
                                </div>
                              )}
                            </div>

                            {/* Meta & actions */}
                            <div className="flex flex-wrap items-center justify-between gap-3 mt-auto pt-2">
                              <span className="flex items-center gap-1.5 text-[12px] font-bold text-muted-foreground bg-black/5 dark:bg-white/5 px-2.5 py-1.5 rounded-lg">
                                <ThumbsUp className="w-[14px] h-[14px]" />
                                {item.likeCount}
                                <span className="opacity-40 px-1">·</span>
                                {Math.round(item.confidence * 100)}% {item.model === 'human' && <span className="opacity-40 px-1">·</span>} {item.model === 'human' && ' corrigé'}
                              </span>

                              <LabelCorrector
                                commentId={item.commentId}
                                currentLabel={item.label}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            );
          })}
        </div>
      )}
      
      {/* End wrappers */}
      </div>
    </div>
  );
}
