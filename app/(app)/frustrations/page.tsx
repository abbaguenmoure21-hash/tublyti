import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquareWarning, AlertTriangle, ThumbsUp, TrendingUp } from 'lucide-react';
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
  channelTitle: string;
  subscriberCount: number;
  score: number;
  baseline: number;
  ageDays: number;
  method: 'same_age' | 'approximate';
  views: number;
}

async function getSmallChannelOutliers(): Promise<OutlierVideo[]> {
  const db = createServiceClient();

  const { data, error } = await db
    .from('video_outliers')
    .select(`
      video_id, score, baseline, age_days, method,
      videos!inner (
        id, title,
        channels!inner (
          title, subscriber_count
        )
      )
    `)
    .gte('score', 1.5)
    .order('score', { ascending: false })
    .limit(100);

  if (error) return [];

  const items: OutlierVideo[] = [];
  for (const row of data ?? []) {
    const video = row.videos as unknown as {
      id: string; title: string;
      channels: { title: string; subscriber_count: number | null };
    };
    const subs = video.channels?.subscriber_count ?? 0;
    if (subs > 50_000) continue; // Only ≤50k

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
      channelTitle: video.channels.title,
      subscriberCount: subs,
      score: Number(row.score),
      baseline: Number(row.baseline),
      ageDays: row.age_days as number,
      method: row.method as 'same_age' | 'approximate',
      views: snaps?.[0]?.views ?? 0,
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

  try {
    const [frustrationItems, outliers] = await Promise.all([
      getFrustrations(),
      getSmallChannelOutliers(),
    ]);
    items = frustrationItems;
    outlierVideos = outliers;
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
      <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Que réclament les spectateurs ?</h1>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="size-10 text-destructive mb-4" />
            <p className="text-sm font-medium text-destructive">
              {fetchError}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Vérifiez votre connexion et rechargez la page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Empty state                                                      */
  /* ---------------------------------------------------------------- */
  if (items.length === 0) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Que réclament les spectateurs ?</h1>
        <Card className="border-dashed border-2 border-primary/20">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary mb-4">
              <MessageSquareWarning className="size-6" />
            </div>
            <p className="font-semibold text-foreground">
              Aucune frustration détectée pour l&apos;instant
            </p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md">
              TubLyTI analyse les commentaires YouTube pour détecter les besoins
              non satisfaits des spectateurs : sujets non traités, vidéos trop
              courtes, demandes explicites.
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              Les frustrations apparaîtront automatiquement après la prochaine
              collecte et classification.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Filter & group                                                   */
  /* ---------------------------------------------------------------- */
  const niches = [...new Set(items.map((i) => i.nicheName))];
  const filtered = filterNiche
    ? items.filter((i) => i.nicheName === filterNiche)
    : items;

  const grouped = new Map<string, Map<string, FrustrationItem[]>>();
  for (const item of filtered) {
    if (!grouped.has(item.nicheName)) grouped.set(item.nicheName, new Map());
    const nicheGroup = grouped.get(item.nicheName)!;
    const videoKey = `${item.videoTitle} — ${item.channelTitle}`;
    if (!nicheGroup.has(videoKey)) nicheGroup.set(videoKey, []);
    nicheGroup.get(videoKey)!.push(item);
  }

  /* ---------------------------------------------------------------- */
  /*  Main content                                                     */
  /* ---------------------------------------------------------------- */
  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Que réclament les spectateurs ?</h1>
          <p className="text-sm text-muted-foreground">
            Commentaires qui expriment un besoin non satisfait
          </p>
        </div>

        <div className="flex items-center gap-3 mt-2 sm:mt-0">
          <Badge variant="secondary">
            {filtered.length} commentaire{filtered.length > 1 ? 's' : ''}
          </Badge>
          <NicheFilter niches={niches} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-[3px] bg-muted rounded-[9px] w-fit">
        <a
          href="/frustrations"
          className={`h-[30px] px-3 rounded-[7px] text-[13px] font-medium transition-colors flex items-center gap-1.5 ${
            tab !== 'outliers'
              ? 'bg-card text-foreground font-semibold shadow-[0_1px_2px_rgba(20,24,34,0.10)]'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <MessageSquareWarning className="w-3.5 h-3.5" />
          Frustrations
        </a>
        <a
          href="/frustrations?tab=outliers"
          className={`h-[30px] px-3 rounded-[7px] text-[13px] font-medium transition-colors flex items-center gap-1.5 ${
            tab === 'outliers'
              ? 'bg-card text-foreground font-semibold shadow-[0_1px_2px_rgba(20,24,34,0.10)]'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          Outliers petites chaînes
          {outlierVideos.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-[11px] h-5">{outlierVideos.length}</Badge>
          )}
        </a>
      </div>

      {/* Outliers tab content */}
      {tab === 'outliers' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Vidéos de chaînes ≤ 50 k abonnés qui surperforment la médiane de leur chaîne.
          </p>
          {outlierVideos.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Aucun outlier de petite chaîne détecté.
              </CardContent>
            </Card>
          ) : (
            <div className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] overflow-hidden">
              <div
                className="grid h-10 items-center px-[18px] bg-background border-b border-border text-[12px] font-medium text-muted-foreground"
                style={{ gridTemplateColumns: '2.5fr 1.2fr 0.8fr 0.8fr 0.7fr' }}
              >
                <span>Vidéo</span>
                <span>Chaîne</span>
                <span>Vues</span>
                <span>Abonnés</span>
                <span>Score</span>
              </div>
              {outlierVideos.map((v) => (
                <a
                  key={v.videoId}
                  href={`https://www.youtube.com/watch?v=${v.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid h-11 items-center px-[18px] border-b border-muted text-[14px] text-foreground transition-colors hover:bg-muted/50 last:border-0"
                  style={{ gridTemplateColumns: '2.5fr 1.2fr 0.8fr 0.8fr 0.7fr' }}
                >
                  <span className="font-medium truncate">{v.videoTitle}</span>
                  <span className="text-muted-foreground truncate">{v.channelTitle}</span>
                  <span className="tabular-nums text-muted-foreground">{formatOutlierViews(v.views)}</span>
                  <span className="tabular-nums text-muted-foreground">{formatSubs(v.subscriberCount)}</span>
                  <span>
                    <OutlierBadge score={v.score} ageDays={v.ageDays} method={v.method} baseline={v.baseline} />
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Frustrations tab content */}
      {tab !== 'outliers' && [...grouped.entries()].map(([nicheName, videos]) => {
        const nicheCount = [...videos.values()].reduce(
          (sum, arr) => sum + arr.length,
          0,
        );

        return (
          <section key={nicheName} className="space-y-4">
            {/* Niche heading */}
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              {nicheName}
              <Badge variant="outline">{nicheCount}</Badge>
            </h2>

            {[...videos.entries()].map(([videoKey, comments]) => (
              <div key={videoKey} className="space-y-2 ml-1">
                {/* Video heading */}
                <h3 className="text-sm font-medium text-muted-foreground">
                  {videoKey}
                </h3>

                {/* Comment cards */}
                {comments.map((item) => (
                  <Card
                    key={item.commentId}
                    className="transition-shadow hover:shadow-md"
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between gap-4">
                        {/* Left: comment text */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                            {item.commentText}
                          </p>
                          {item.requestedAngle && (
                            <p className="mt-1.5 text-xs text-primary-ink italic">
                              Angle : {item.requestedAngle}
                            </p>
                          )}
                        </div>

                        {/* Right: label, meta, actions */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <LabelBadge label={item.label} />

                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <ThumbsUp className="size-3" />
                            {item.likeCount}
                            {' · '}
                            {Math.round(item.confidence * 100)} %
                            {item.model === 'human' && ' · corrigé'}
                          </span>

                          <LabelCorrector
                            commentId={item.commentId}
                            currentLabel={item.label}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
