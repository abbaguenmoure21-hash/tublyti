'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SignalChart } from '@/components/charts/signal-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  ExternalLink,
  ThumbsUp,
  Copy,
  Sparkles,
  AlertTriangle,
  Play,
  Check,
} from 'lucide-react';

interface TopicScore {
  mgi: number;
  demand: number;
  frustration: number;
  supply_q: number;
  monetization: number;
  phase: number;
}

interface Competitor {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  views: number;
}

interface FrustrationComment {
  commentId: string;
  text: string;
  likeCount: number;
  label: string;
  requestedAngle: string | null;
  confidence: number;
}

interface Angle {
  id: string;
  title: string;
  hook: string;
  rationale: string;
  status: string;
  video_id: string | null;
  created_at: string;
}

interface TopicDetail {
  id: string;
  label: string;
  phase: number | null;
  status: string;
  niches: { name: string; rpm_coefficient: number } | null;
  score: TopicScore | null;
  competitors: Competitor[];
  frustrations: FrustrationComment[];
  angles: Angle[];
}

interface DataPoint {
  date: string;
  value: number;
}

type SignalSeries = Record<string, DataPoint[]>;

const PHASE_LABELS: Record<number, string> = {
  0: 'Emergence',
  1: 'Viralite courte',
  2: 'Fenetre ideale',
  3: 'Saturation',
};

const PHASE_COLORS: Record<number, string> = {
  0: 'bg-green-100 text-green-700 border-green-200',
  1: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  2: 'bg-blue-100 text-blue-700 border-blue-200',
  3: 'bg-red-100 text-red-700 border-red-200',
};

const PHASE_EXPLANATIONS: Record<number, string> = {
  0: 'Le sujet emerge sur les reseaux sociaux sans offre qualifiee sur YouTube.',
  1: 'La demande est presente mais la fenetre se referme rapidement.',
  2: 'Fort interet, peu de concurrence qualifiee : moment ideal pour publier.',
  3: 'Trop de videos qualifiees recentes, la fenetre est fermee.',
};

const LABEL_NAMES: Record<string, string> = {
  no_one_explains: 'Personne ne traite',
  wish_video_on: 'Souhait de video',
  stopped_too_early: 'Trop court',
  searched_long: 'Longue recherche',
};

const LABEL_COLORS: Record<string, string> = {
  no_one_explains: 'bg-red-100 text-red-700 border-red-200',
  wish_video_on: 'bg-blue-100 text-blue-700 border-blue-200',
  stopped_too_early: 'bg-amber-100 text-amber-700 border-amber-200',
  searched_long: 'bg-purple-100 text-purple-700 border-purple-200',
};

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export default function TopicPage() {
  const { id } = useParams<{ id: string }>();
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [signals, setSignals] = useState<SignalSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [publishVideoId, setPublishVideoId] = useState('');
  const [showPublishInput, setShowPublishInput] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genCost, setGenCost] = useState<number | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [topicRes, signalsRes] = await Promise.all([
        fetch(`/api/topics/${id}`),
        fetch(`/api/topics/${id}/signals`),
      ]);

      if (!topicRes.ok) throw new Error('Erreur chargement sujet');
      if (!signalsRes.ok) throw new Error('Erreur chargement signaux');

      setTopic(await topicRes.json());
      setSignals(await signalsRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStatusChange = async (
    action: 'mark_production' | 'mark_published',
    videoId?: string,
  ) => {
    setActing(true);
    try {
      const res = await fetch(`/api/topics/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, videoId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Erreur');
      }
      setShowPublishInput(false);
      setPublishVideoId('');
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setActing(false);
    }
  };

  const handleGenerateAngles = async () => {
    setGenerating(true);
    setGenError(null);
    setGenCost(null);
    try {
      const res = await fetch(`/api/topics/${id}/angles`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erreur');
      setGenCost(data.costUSD);
      await fetchData();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setGenerating(false);
    }
  };

  const buildBrief = (angle: Angle): string => {
    if (!topic) return '';
    const lines: string[] = [
      `# Brief — ${angle.title}`,
      '',
      `**Sujet :** ${topic.label}`,
      `**Niche :** ${topic.niches?.name ?? '?'} (RPM x${topic.niches?.rpm_coefficient ?? '?'})`,
      `**Phase :** ${topic.phase !== null ? PHASE_LABELS[topic.phase] ?? topic.phase : '?'}`,
      '',
      `## Angle`,
      '',
      `**Titre :** ${angle.title}`,
      `**Hook :** ${angle.hook}`,
      `**Rationale :** ${angle.rationale}`,
      '',
      `## Frustrations sources (top ${Math.min(topic.frustrations.length, 10)})`,
      '',
    ];
    for (const f of topic.frustrations.slice(0, 10)) {
      const angleNote = f.requestedAngle ? ` → ${f.requestedAngle}` : '';
      lines.push(`- [${f.likeCount} likes] ${f.text.slice(0, 200)}${angleNote}`);
    }
    lines.push('', '## Concurrents', '');
    for (const c of topic.competitors.slice(0, 10)) {
      lines.push(`- ${c.title} (${c.channelTitle})`);
    }
    return lines.join('\n');
  };

  const handleCopyBrief = async (angle: Angle) => {
    const brief = buildBrief(angle);
    await navigator.clipboard.writeText(brief);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Estimated cost: $3/MTok input + $15/MTok output, ~2000+1200 tokens
  const estimatedCost = ((2000 * 3) / 1_000_000 + (1200 * 15) / 1_000_000);

  /* ---------- Loading state ---------- */
  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-80" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-28 rounded-full" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  /* ---------- Error state ---------- */
  if (error) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <AlertTriangle className="size-10 mb-3 text-destructive" />
            <p className="text-sm font-medium text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ---------- Not found state ---------- */
  if (!topic) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <AlertTriangle className="size-10 mb-3" />
            <p className="text-sm">Sujet introuvable.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const score = topic.score;
  const phase = score?.phase ?? topic.phase;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        Retour au tableau de bord
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {topic.niches?.name ?? 'Niche inconnue'}
          </Badge>
          <Badge variant="secondary">{topic.status}</Badge>
          {phase !== null && phase !== undefined && (
            <Badge className={PHASE_COLORS[phase] ?? 'bg-muted text-muted-foreground'}>
              Phase {phase} — {PHASE_LABELS[phase] ?? '?'}
            </Badge>
          )}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{topic.label}</h1>
        {phase !== null && phase !== undefined && (
          <p className="text-sm text-muted-foreground italic">
            {PHASE_EXPLANATIONS[phase] ?? ''}
          </p>
        )}
      </div>

      <Separator />

      {/* MGI + score components */}
      {score && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <ScoreCard
            label="MGI"
            value={score.mgi.toFixed(1)}
            highlight
          />
          <ScoreCard
            label="Demande (D)"
            value={score.demand.toFixed(0)}
          />
          <ScoreCard
            label="Frustration (F)"
            value={`${(score.frustration * 100).toFixed(0)}%`}
          />
          <ScoreCard
            label="Offre (O_q)"
            value={score.supply_q.toFixed(1)}
          />
          <ScoreCard
            label="Monetisation (P)"
            value={`x${score.monetization.toFixed(1)}`}
          />
        </div>
      )}

      {/* Action buttons */}
      {(topic.status === 'active' || topic.status === 'in_production') && (
        <div className="flex flex-wrap items-center gap-3">
          {topic.status === 'active' && (
            <Button
              variant="default"
              onClick={() => handleStatusChange('mark_production')}
              disabled={acting}
            >
              <Play className="size-4" />
              Marquer en production
            </Button>
          )}
          {topic.status === 'in_production' && !showPublishInput && (
            <Button
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={() => setShowPublishInput(true)}
            >
              <Check className="size-4" />
              Marquer publiee
            </Button>
          )}
          {showPublishInput && (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder="ID de la video YouTube"
                value={publishVideoId}
                onChange={(e) => setPublishVideoId(e.target.value)}
                className="w-52"
              />
              <Button
                className="bg-green-600 text-white hover:bg-green-700"
                onClick={() =>
                  handleStatusChange('mark_published', publishVideoId)
                }
                disabled={acting || !publishVideoId.trim()}
              >
                Confirmer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowPublishInput(false);
                  setPublishVideoId('');
                }}
              >
                annuler
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Signal chart */}
      <Card>
        <CardHeader>
          <CardTitle>Signaux sur 90 jours</CardTitle>
        </CardHeader>
        <CardContent>
          {signals ? (
            <SignalChart series={signals} />
          ) : (
            <p className="text-sm text-muted-foreground">Aucune donnee disponible.</p>
          )}
        </CardContent>
      </Card>

      {/* Competitor videos */}
      <Card>
        <CardHeader>
          <CardTitle>Videos qualifiees concurrentes</CardTitle>
        </CardHeader>
        <CardContent>
          {topic.competitors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune video qualifiee trouvee pour ce sujet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="py-2.5 px-3 text-left font-medium text-muted-foreground">Titre</th>
                    <th className="py-2.5 px-3 text-left font-medium text-muted-foreground">Chaine</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground">Vues</th>
                    <th className="py-2.5 px-3 text-right font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {topic.competitors.map((v) => (
                    <tr
                      key={v.id}
                      className="border-b last:border-0 transition-colors hover:bg-muted/30"
                    >
                      <td className="py-2.5 px-3">
                        <a
                          href={`https://youtube.com/watch?v=${v.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {v.title}
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground text-xs">
                        {v.channelTitle}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {formatViews(v.views)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-muted-foreground text-xs">
                        {new Date(v.publishedAt).toLocaleDateString('fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Frustrated comments */}
      <Card>
        <CardHeader>
          <CardTitle>
            Commentaires frustres ({topic.frustrations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topic.frustrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun commentaire de frustration detecte.
            </p>
          ) : (
            <div className="space-y-3">
              {topic.frustrations.map((f) => (
                <Card
                  key={f.commentId}
                  size="sm"
                  className="transition-shadow hover:shadow-md"
                >
                  <CardContent>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-foreground whitespace-pre-wrap break-words flex-1">
                        {f.text}
                      </p>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <Badge
                          className={LABEL_COLORS[f.label] ?? 'bg-muted text-muted-foreground'}
                        >
                          {LABEL_NAMES[f.label] ?? f.label}
                        </Badge>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <ThumbsUp className="size-3" />
                          {f.likeCount}
                        </span>
                      </div>
                    </div>
                    {f.requestedAngle && (
                      <p className="mt-2 text-xs text-primary italic">
                        Angle : {f.requestedAngle}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Angles */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Angles de contenu</CardTitle>
          <div className="flex items-center gap-3">
            {genCost !== null && (
              <span className="text-xs text-muted-foreground">
                Cout : ${genCost.toFixed(4)}
              </span>
            )}
            <Button
              variant="default"
              size="sm"
              onClick={handleGenerateAngles}
              disabled={generating}
            >
              <Sparkles className="size-3.5" />
              {generating
                ? 'Generation...'
                : topic.angles.length > 0
                  ? `Regenerer (~$${estimatedCost.toFixed(3)})`
                  : `Generer 5 angles (~$${estimatedCost.toFixed(3)})`}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {genError && (
            <p className="text-sm text-destructive mb-3">{genError}</p>
          )}

          {topic.angles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun angle genere pour ce sujet.
            </p>
          ) : (
            <div className="space-y-3">
              {topic.angles.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium text-sm">{a.title}</h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleCopyBrief(a)}
                      >
                        {copied ? (
                          <>
                            <Check className="size-3" />
                            Copie !
                          </>
                        ) : (
                          <>
                            <Copy className="size-3" />
                            Copier le brief
                          </>
                        )}
                      </Button>
                      <Badge variant="secondary">{a.status}</Badge>
                    </div>
                  </div>
                  {a.hook && (
                    <p className="text-sm text-muted-foreground italic">
                      {a.hook}
                    </p>
                  )}
                  {a.rationale && (
                    <p className="text-xs text-muted-foreground">
                      {a.rationale}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card
      className={
        highlight
          ? 'bg-primary/5 border-primary/20'
          : ''
      }
    >
      <CardContent className="flex flex-col items-center justify-center py-3 text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`text-xl font-bold mt-1 ${
            highlight ? 'text-primary' : 'text-foreground'
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
