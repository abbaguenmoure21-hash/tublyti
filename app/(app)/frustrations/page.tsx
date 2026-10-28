import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export const metadata = { title: 'Questions du public' };
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { MessageSquareWarning, AlertTriangle, ThumbsUp, TrendingUp, Lightbulb, Target, Clock, Search, PlaySquare } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { LabelCorrector } from './_components/label-corrector';
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

async function getFrustrations(ids: string[]): Promise<FrustrationItem[]> {
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
    .in('comments.videos.channels.niche_id', ids)
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

async function getSmallChannelOutliers(filterNiche: string, ids: string[]): Promise<OutlierVideo[]> {
  const db = createServiceClient();

  let query = db
    .from('video_outliers')
    .select(`
      video_id, score, baseline, age_days, method,
      videos!inner (
        id, title, thumbnail_url,
        channels!inner (
          id, title, subscriber_count, niche_id,
          niches!inner (
            name
          )
        )
      )
    `)
    .gte('score', 1.5)
    .in('videos.channels.niche_id', ids)
    .lte('videos.channels.subscriber_count', 50000)
    .lte('age_days', 365); // Filter out old videos (>1 year)
    
  if (filterNiche) {
    query = query.eq('videos.channels.niches.name', filterNiche);
  }

  const { data, error } = await query
    .order('score', { ascending: false })
    .limit(600);

  if (error) return [];

  // Vues les plus récentes : une seule requête pour les 30 vidéos retenues (au lieu d'une par vidéo).
  // Les plus récentes d'abord (60 derniers jours), puis le reste de l'année ; 2 vidéos par chaîne au plus,
  // pour que la liste change au fil des nuits au lieu de montrer toujours les mêmes records anciens.
  const rows = ((data ?? []) as Record<string, unknown>[]).filter(
    (row) => ((row.videos as unknown as { channels: { subscriber_count: number | null } }).channels?.subscriber_count ?? 0) <= 50_000,
  );
  const fresh = rows.filter((r) => Number(r.age_days) <= 60);
  const older = rows.filter((r) => Number(r.age_days) > 60);
  const perChannel = new Map<string, number>();
  const kept: Record<string, unknown>[] = [];
  for (const row of [...fresh, ...older]) {
    const ch = (row.videos as unknown as { channels: { id: string } }).channels?.id ?? '';
    if ((perChannel.get(ch) ?? 0) >= 2) continue;
    perChannel.set(ch, (perChannel.get(ch) ?? 0) + 1);
    kept.push(row);
    if (kept.length >= 30) break;
  }
  const latestViews = new Map<string, number>();
  if (kept.length) {
    const { data: snapRows } = await db
      .from('video_snapshots')
      .select('video_id, views, captured_at')
      .in('video_id', kept.map((r: Record<string, unknown>) => r.video_id as string))
      .order('captured_at', { ascending: false })
      .limit(2000);
    for (const sn of (snapRows ?? []) as { video_id: string; views: number | null }[]) {
      if (!latestViews.has(sn.video_id)) latestViews.set(sn.video_id, Number(sn.views ?? 0));
    }
  }

  const items: OutlierVideo[] = [];
  for (const row of kept) {
    const video = row.videos as unknown as {
      id: string; title: string; thumbnail_url: string | null;
      channels: { 
        id: string; title: string; subscriber_count: number | null;
        niches: { name: string };
      };
    };
    const subs = video.channels?.subscriber_count ?? 0;
    if (subs > 50_000) continue; // safety check


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
      views: latestViews.get(row.video_id as string) ?? 0,
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

  const user = await requireUser();
  const isAdmin = user.role === 'admin';
  try {
    const db = createServiceClient();
    // Uniquement les thématiques du client.
    const { nicheIds } = await resolveScope(db, user.id);
    const ids = nicheIds.length ? nicheIds : ['00000000-0000-0000-0000-000000000000'];
    const [frustrationItems, outliers, { data: nichesData }] = await Promise.all([
      getFrustrations(ids),
      getSmallChannelOutliers(filterNiche, ids),
      db.from('niches').select('name').in('id', ids).order('name'),
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
        </div>
        <div className="flex-1 p-6 md:px-12 md:py-10 flex flex-col gap-8 w-full max-w-[1400px] mx-auto">
          <h1 className="text-title-1 leading-tight">Que réclame ton public ?</h1>
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
        </div>
        <div className="flex-1 p-6 md:px-12 md:py-10 flex flex-col gap-8 w-full max-w-[1400px] mx-auto">
          <h1 className="text-title-1 leading-tight">Que réclame ton public ?</h1>
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
      title: 'Vidéos réclamées',
      description: 'Le public demande explicitement une vidéo sur ce sujet. Crée-la pour répondre à une demande directe.',
      icon: Lightbulb,
      colorClass: 'text-primary'
    },
    {
      id: 'no_one_explains',
      title: 'Explications manquantes',
      description: 'Personne n\'explique ce point clairement. Une vidéo claire te place comme la référence.',
      icon: Target,
      colorClass: 'text-purple-500 dark:text-purple-400'
    },
    {
      id: 'stopped_too_early',
      title: 'Sujets survolés',
      description: 'Le créateur est passé trop vite sur un point. Fais une vidéo entière dessus pour approfondir.',
      icon: Clock,
      colorClass: 'text-orange-500 dark:text-orange-400'
    },
    {
      id: 'searched_long',
      title: 'Recherches difficiles',
      description: 'Le public a cherché longtemps avant de trouver. Reprends ces mots exacts dans tes titres pour être trouvé.',
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
      </div>

      <div className="flex w-full flex-1 flex-col gap-6 overflow-x-hidden px-4 pb-12 pt-5 md:px-8">
        {/* En-tête : même grand titre que Sujets et Carte. La chaîne se choisit dans « Afficher ». */}
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">Que réclame ton public ?</h1>
          <p className="max-w-[760px] text-[15px] leading-relaxed text-muted-foreground">
            {filtered.length} commentaire{filtered.length > 1 ? 's' : ''} récent{filtered.length > 1 ? 's' : ''} qui demandent une vidéo, signalent une explication manquante ou trop rapide.
            Chacun est une idée de vidéo.
          </p>
        </header>

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
          Ce que le public réclame
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
          Petites chaînes qui surperforment
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
              Vidéos de chaînes <strong className="text-foreground font-bold">≤ 50 k abonnés</strong> qui surperforment la moyenne de leur chaîne. Les vidéos des 60 derniers jours d’abord, puis le reste de l’année ; 2 par chaîne au plus. Mis à jour chaque nuit.
            </p>
          </div>
          {outlierVideos.length === 0 ? (
            <div className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-sm rounded-[24px] py-16 flex flex-col items-center justify-center text-center gap-3">
              <Search className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-[15px] text-muted-foreground font-medium">
                Aucune petite chaîne n’a surperformé récemment.
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
                                “{item.commentText}”
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

                              {isAdmin && (
                                <LabelCorrector
                                  commentId={item.commentId}
                                  currentLabel={item.label}
                                />
                              )}
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
