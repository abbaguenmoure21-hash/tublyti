'use client';

import { useEffect, useState, useCallback } from 'react';
import { ListChecks, AlertTriangle, Check, X, GitMerge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';

interface VideoInfo {
  id: string;
  title: string;
  channel_id: string;
  published_at: string;
  channels: { title: string } | null;
}

interface ProposedTopic {
  id: string;
  label: string;
  status: string;
  phase: number | null;
  created_at: string;
  niches: { name: string } | null;
  videos: VideoInfo[];
}

interface MergeTarget {
  id: string;
  label: string;
  niches: { name: string } | null;
}

type ActionState = {
  topicId: string;
  action: 'accept' | 'reject' | 'merge';
  mergeInto?: string;
} | null;

function LoadingSkeleton() {
  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-6 w-3/4" />
            <div className="flex items-center gap-2 pt-1">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </CardContent>
          <div className="px-(--card-spacing) pb-(--card-spacing)">
            <Separator />
            <div className="flex items-center gap-3 pt-4">
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="h-8 w-20 rounded-lg" />
              <div className="ml-auto flex items-center gap-2">
                <Skeleton className="h-8 w-48 rounded-lg" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function TopicsReviewPage() {
  const [proposed, setProposed] = useState<ProposedTopic[]>([]);
  const [mergeTargets, setMergeTargets] = useState<MergeTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<ActionState>(null);
  const [mergeSelection, setMergeSelection] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/topics/review');
      if (!res.ok) throw new Error('Erreur lors du chargement');
      const data = await res.json();
      setProposed(data.proposed ?? []);
      setMergeTargets(data.mergeTargets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAction = async (
    topicId: string,
    action: 'accept' | 'reject' | 'merge',
    mergeInto?: string,
  ) => {
    setActing({ topicId, action, mergeInto });
    try {
      const res = await fetch('/api/topics/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId, action, mergeInto }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Erreur');
      }
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="size-10 text-destructive mb-4" />
            <p className="text-lg font-semibold text-destructive">
              Une erreur est survenue
            </p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (proposed.length === 0) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Sujets a valider
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Validez, rejetez ou fusionnez les sujets detectes automatiquement.
          </p>
        </div>
        <Card className="border-dashed border-2 border-primary/20">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary mb-4">
              <ListChecks className="size-6" />
            </div>
            <p className="text-lg font-semibold text-foreground">
              Aucun sujet en attente de validation
            </p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md">
              Apres chaque collecte, TubLyTI regroupe les videos par sujet et vous les propose ici.
              Vous pourrez alors les accepter, les rejeter, ou les fusionner avec un sujet existant.
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              Les sujets apparaitront automatiquement apres la prochaine collecte de nuit.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          Sujets a valider
        </h1>
        <Badge variant="secondary">
          {proposed.length}
        </Badge>
        <p className="hidden sm:block text-sm text-muted-foreground ml-auto">
          Validez, rejetez ou fusionnez les sujets detectes automatiquement.
        </p>
      </div>

      <div className="space-y-4">
        {proposed.map((topic) => {
          const isActing = acting?.topicId === topic.id;

          return (
            <Card key={topic.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <CardTitle className="text-lg font-semibold">
                      {topic.label}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {topic.niches && (
                        <Badge variant="outline">{topic.niches.name}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(topic.created_at).toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </CardHeader>

              {topic.videos.length > 0 && (
                <CardContent>
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                    {topic.videos.length} video{topic.videos.length > 1 ? 's' : ''} membre{topic.videos.length > 1 ? 's' : ''}
                  </p>
                  <ul className="space-y-1">
                    {topic.videos.slice(0, 10).map((v) => (
                      <li
                        key={v.id}
                        className="flex items-center gap-2 text-sm text-foreground"
                      >
                        <span className="text-muted-foreground shrink-0">
                          &bull;
                        </span>
                        <span className="truncate">{v.title}</span>
                        {v.channels && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            — {v.channels.title}
                          </span>
                        )}
                      </li>
                    ))}
                    {topic.videos.length > 10 && (
                      <li className="text-xs text-muted-foreground italic pl-4">
                        et {topic.videos.length - 10} autre{topic.videos.length - 10 > 1 ? 's' : ''}...
                      </li>
                    )}
                  </ul>
                </CardContent>
              )}

              <div className="px-(--card-spacing) pb-(--card-spacing)">
                <Separator />
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-4">
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => handleAction(topic.id, 'accept')}
                      disabled={isActing}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Check className="size-4" />
                      {isActing && acting?.action === 'accept'
                        ? 'Validation...'
                        : 'Accepter'}
                    </Button>

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleAction(topic.id, 'reject')}
                      disabled={isActing}
                    >
                      <X className="size-3.5" />
                      {isActing && acting?.action === 'reject'
                        ? 'Rejet...'
                        : 'Rejeter'}
                    </Button>
                  </div>

                  <div className="flex items-center gap-2 sm:ml-auto">
                    <GitMerge className="size-4 text-muted-foreground hidden sm:block" />
                    <select
                      value={mergeSelection[topic.id] ?? ''}
                      onChange={(e) =>
                        setMergeSelection((prev) => ({
                          ...prev,
                          [topic.id]: e.target.value,
                        }))
                      }
                      className="h-8 rounded-lg border border-border bg-background px-2 text-sm max-w-[250px] focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="">Fusionner avec...</option>
                      {mergeTargets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                          {t.niches ? ` (${t.niches.name})` : ''}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const target = mergeSelection[topic.id];
                        if (!target) {
                          alert('Selectionnez un sujet cible pour la fusion.');
                          return;
                        }
                        handleAction(topic.id, 'merge', target);
                      }}
                      disabled={isActing || !mergeSelection[topic.id]}
                    >
                      <GitMerge className="size-4" />
                      {isActing && acting?.action === 'merge'
                        ? 'Fusion...'
                        : 'Fusionner'}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
