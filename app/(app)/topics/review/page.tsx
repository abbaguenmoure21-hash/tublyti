import { ListChecks, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Données lues à chaque visite (jamais calculées pendant pnpm build).
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Revue des sujets' };
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PhaseBadge } from '@/components/tublyti/phase-badge';
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
    <div className="flex-1 flex flex-col min-h-full relative overflow-x-clip">
      {/* Background gradients multi-niveaux */}
      <div className="absolute inset-0 pointer-events-none -z-10">
      </div>

      <div className="flex-1 p-6 md:px-12 md:py-10 flex flex-col gap-8 w-full max-w-5xl mx-auto">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-[32px] font-bold tracking-tight text-foreground leading-tight">
              Sujets à valider
            </h1>
            <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 font-bold">
              {proposed.length}
            </Badge>
          </div>
          <p className="text-[16px] font-medium text-muted-foreground/80">
            Validez, rejetez ou fusionnez les sujets détectés automatiquement.
          </p>
        </div>

      <div className="space-y-6">
        {proposed.map((topic) => (
          <div key={topic.id} className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-[0_4px_20px_rgb(0,0,0,0.03)] rounded-[24px] overflow-hidden transition-all hover:bg-white/80 dark:hover:bg-white/10 hover:border-black/5 dark:hover:border-white/20 flex flex-col">
            <div className="p-6 pb-4">
              <h2 className="text-[20px] font-bold text-foreground">
                {topic.label}
              </h2>
              <div className="flex items-center gap-2 mt-3">
                {topic.niches && (
                  <span className="text-[12px] font-bold text-muted-foreground bg-white dark:bg-white/10 border border-black/5 dark:border-white/10 shadow-sm rounded-full px-3 py-1 shrink-0">
                    {topic.niches.name}
                  </span>
                )}
                <PhaseBadge phase={topic.phase} />
                <span className="text-[12px] font-medium text-muted-foreground ml-2">
                  {new Date(topic.created_at).toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
            {topic.videos.length > 0 && (
              <div className="px-6 pb-6">
                <div className="bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-[16px] p-4">
                  <p className="text-[11px] font-bold text-muted-foreground mb-3 uppercase tracking-wide">
                    {topic.videos.length} video{topic.videos.length > 1 ? 's' : ''} membre{topic.videos.length > 1 ? 's' : ''}
                  </p>
                  <ul className="space-y-2">
                    {topic.videos.slice(0, 10).map((v) => (
                      <li
                        key={v.id}
                        className="flex items-center gap-2 text-[13px] text-foreground"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                        <span className="font-medium truncate">{v.title}</span>
                        {v.channels && (
                          <span className="text-muted-foreground shrink-0 truncate max-w-[120px] sm:max-w-[200px]">
                            — {v.channels.title}
                          </span>
                        )}
                      </li>
                    ))}
                    {topic.videos.length > 10 && (
                      <li className="text-[12px] text-muted-foreground italic pl-3.5 mt-2">
                        et {topic.videos.length - 10} autre{topic.videos.length - 10 > 1 ? 's' : ''}...
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}

            <div className="px-6 py-4 border-t border-black/5 dark:border-white/10 bg-black/5 dark:bg-transparent">
              <ReviewActions topicId={topic.id} mergeTargets={mergeTargets} />
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
