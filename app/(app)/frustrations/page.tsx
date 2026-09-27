'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquareWarning, AlertTriangle, ThumbsUp } from 'lucide-react';

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
  wish_video_on: 'Souhait de video',
  stopped_too_early: 'Trop court',
  searched_long: 'Longue recherche',
  none: 'Aucun',
};

const LABEL_COLORS: Record<string, string> = {
  no_one_explains: 'bg-red-100 text-red-800',
  wish_video_on: 'bg-blue-100 text-blue-800',
  stopped_too_early: 'bg-amber-100 text-amber-800',
  searched_long: 'bg-purple-100 text-purple-800',
  none: 'bg-gray-100 text-gray-600',
};

const ALL_LABELS = [
  'no_one_explains',
  'wish_video_on',
  'stopped_too_early',
  'searched_long',
  'none',
] as const;

function LabelBadge({ label }: { label: string }) {
  const name = LABEL_NAMES[label] ?? label;

  switch (label) {
    case 'no_one_explains':
      return <Badge variant="destructive">{name}</Badge>;
    case 'wish_video_on':
      return <Badge variant="default">{name}</Badge>;
    case 'stopped_too_early':
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
          {name}
        </Badge>
      );
    case 'searched_long':
      return (
        <Badge variant="outline" className="border-purple-300 text-purple-700 dark:border-purple-600 dark:text-purple-400">
          {name}
        </Badge>
      );
    default:
      return <Badge variant="secondary">{name}</Badge>;
  }
}

export default function FrustrationsPage() {
  const [items, setItems] = useState<FrustrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterNiche, setFilterNiche] = useState<string>('');
  const [editing, setEditing] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/frustrations');
      if (!res.ok) throw new Error('Erreur lors du chargement');
      const data = await res.json();
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCorrect = async (
    commentId: string,
    newLabel: string,
  ) => {
    try {
      const res = await fetch(`/api/frustrations/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel }),
      });
      if (!res.ok) throw new Error('Erreur de correction');
      setEditing(null);
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const niches = [...new Set(items.map((i) => i.nicheName))];
  const filtered = filterNiche
    ? items.filter((i) => i.nicheName === filterNiche)
    : items;

  // Group by niche then by video
  const grouped = new Map<string, Map<string, FrustrationItem[]>>();
  for (const item of filtered) {
    if (!grouped.has(item.nicheName)) grouped.set(item.nicheName, new Map());
    const nicheGroup = grouped.get(item.nicheName)!;
    const videoKey = `${item.videoTitle} — ${item.channelTitle}`;
    if (!nicheGroup.has(videoKey)) nicheGroup.set(videoKey, []);
    nicheGroup.get(videoKey)!.push(item);
  }

  /* ------------------------------------------------------------------ */
  /*  Loading state                                                      */
  /* ------------------------------------------------------------------ */
  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 pt-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-4 w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Error state                                                        */
  /* ------------------------------------------------------------------ */
  if (error) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Frustrations</h1>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="size-10 text-destructive mb-4" />
            <p className="text-sm font-medium text-destructive">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Verifiez votre connexion et rechargez la page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Empty state                                                        */
  /* ------------------------------------------------------------------ */
  if (items.length === 0) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Frustrations</h1>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquareWarning className="size-10 text-muted-foreground mb-4" />
            <p className="text-sm font-medium text-foreground">
              Aucun commentaire classifie
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Lancez le cron <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">classify</code> pour analyser les commentaires.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Main content                                                       */
  /* ------------------------------------------------------------------ */
  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Frustrations</h1>
          <p className="text-sm text-muted-foreground">
            Commentaires exprimant un besoin non satisfait
          </p>
        </div>

        <div className="flex items-center gap-3 mt-2 sm:mt-0">
          <Badge variant="secondary">
            {filtered.length} commentaire{filtered.length > 1 ? 's' : ''}
          </Badge>
          <select
            value={filterNiche}
            onChange={(e) => setFilterNiche(e.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="">Toutes les niches</option>
            {niches.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grouped content */}
      {[...grouped.entries()].map(([nicheName, videos]) => {
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
                            <p className="mt-1.5 text-xs text-indigo-600 italic dark:text-indigo-400">
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
                            {Math.round(item.confidence * 100)}%
                            {item.model === 'human' && ' · corrige'}
                          </span>

                          {editing === item.commentId ? (
                            <div className="flex flex-wrap gap-1">
                              {ALL_LABELS.map((l) => (
                                <Button
                                  key={l}
                                  variant="outline"
                                  size="xs"
                                  onClick={() =>
                                    handleCorrect(item.commentId, l)
                                  }
                                  className={
                                    l === item.label
                                      ? 'ring-2 ring-primary'
                                      : ''
                                  }
                                >
                                  {LABEL_NAMES[l]}
                                </Button>
                              ))}
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => setEditing(null)}
                              >
                                annuler
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setEditing(item.commentId)}
                            >
                              corriger
                            </Button>
                          )}
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
