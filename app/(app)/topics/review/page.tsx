import { ListChecks, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PhaseBadge } from '@/components/tublyti';
import { createServiceClient } from '@/lib/supabase/server';
import { ReviewActions } from './_components/review-actions';

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

export default async function TopicsReviewPage() {
  const db = createServiceClient();

  const [proposedResult, activeResult] = await Promise.all([
    db
      .from('topics')
      .select(`
        id, label, status, phase, created_at,
        niches(name),
        videos(id, title, channel_id, published_at, channels(title))
      `)
      .eq('status', 'proposed')
      .order('created_at', { ascending: false }),
    db
      .from('topics')
      .select('id, label, niches(name)')
      .eq('status', 'active'),
  ]);

  if (proposedResult.error) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="size-10 text-destructive mb-4" />
            <p className="text-lg font-semibold text-destructive">
              Une erreur est survenue
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {proposedResult.error.message}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const proposed: ProposedTopic[] = proposedResult.data ?? [];
  const mergeTargets: MergeTarget[] = activeResult.data ?? [];

  if (proposed.length === 0) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Quels sujets valider ?
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Validez, rejetez ou fusionnez les sujets détectés automatiquement.
          </p>
        </div>
        <Card className="border-dashed border-2 border-primary/20">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-soft text-primary-ink mb-4">
              <ListChecks className="size-6" />
            </div>
            <p className="text-lg font-semibold text-foreground">
              Aucun sujet en attente de validation
            </p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md">
              Après chaque collecte, TubLyTI regroupe les vidéos par sujet et vous les propose ici.
              Vous pourrez alors les accepter, les rejeter, ou les fusionner avec un sujet existant.
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              Les sujets apparaîtront automatiquement après la prochaine collecte de nuit.
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
          Sujets à valider
        </h1>
        <Badge variant="secondary">
          {proposed.length}
        </Badge>
        <p className="hidden sm:block text-sm text-muted-foreground ml-auto">
          Validez, rejetez ou fusionnez les sujets détectés automatiquement.
        </p>
      </div>

      <div className="space-y-4">
        {proposed.map((topic) => (
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
                    <PhaseBadge phase={topic.phase} />
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
              <ReviewActions topicId={topic.id} mergeTargets={mergeTargets} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
