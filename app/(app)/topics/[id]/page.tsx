'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { SignalChart } from '@/components/charts/signal-chart';

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
  0: 'bg-green-100 text-green-700',
  1: 'bg-yellow-100 text-yellow-700',
  2: 'bg-blue-100 text-blue-700',
  3: 'bg-red-100 text-red-700',
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
  no_one_explains: 'bg-red-100 text-red-700',
  wish_video_on: 'bg-blue-100 text-blue-700',
  stopped_too_early: 'bg-amber-100 text-amber-700',
  searched_long: 'bg-purple-100 text-purple-700',
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

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">Chargement...</div>
    );
  }

  if (error) {
    return <div className="p-8 text-center text-red-600">{error}</div>;
  }

  if (!topic) {
    return (
      <div className="p-8 text-center text-gray-500">Sujet introuvable.</div>
    );
  }

  const score = topic.score;
  const phase = score?.phase ?? topic.phase;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm text-gray-500">
          {topic.niches?.name ?? 'Niche inconnue'}
        </p>
        <h1 className="text-2xl font-bold mt-1">{topic.label}</h1>
        <div className="flex flex-wrap gap-2 mt-2">
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
            {topic.status}
          </span>
          {phase !== null && phase !== undefined && (
            <span
              className={`text-xs px-2 py-0.5 rounded ${PHASE_COLORS[phase] ?? 'bg-gray-100'}`}
            >
              Phase {phase} — {PHASE_LABELS[phase] ?? '?'}
            </span>
          )}
        </div>
        {phase !== null && phase !== undefined && (
          <p className="text-sm text-gray-500 mt-1 italic">
            {PHASE_EXPLANATIONS[phase] ?? ''}
          </p>
        )}
      </div>

      {/* MGI + components */}
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
            <button
              onClick={() => handleStatusChange('mark_production')}
              disabled={acting}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
            >
              Marquer en production
            </button>
          )}
          {topic.status === 'in_production' && !showPublishInput && (
            <button
              onClick={() => setShowPublishInput(true)}
              className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 cursor-pointer"
            >
              Marquer publiee
            </button>
          )}
          {showPublishInput && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="ID de la video YouTube"
                value={publishVideoId}
                onChange={(e) => setPublishVideoId(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm w-48"
              />
              <button
                onClick={() =>
                  handleStatusChange('mark_published', publishVideoId)
                }
                disabled={acting || !publishVideoId.trim()}
                className="px-4 py-1.5 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 cursor-pointer"
              >
                Confirmer
              </button>
              <button
                onClick={() => {
                  setShowPublishInput(false);
                  setPublishVideoId('');
                }}
                className="text-xs text-gray-400 underline cursor-pointer"
              >
                annuler
              </button>
            </div>
          )}
        </div>
      )}

      {/* Signal chart */}
      <div className="border rounded-lg p-4 md:p-6 bg-white">
        <h2 className="text-lg font-semibold mb-4">Signaux sur 90 jours</h2>
        {signals ? (
          <SignalChart series={signals} />
        ) : (
          <p className="text-sm text-gray-400">Aucune donnee disponible.</p>
        )}
      </div>

      {/* Competitor videos */}
      <div className="border rounded-lg p-4 md:p-6 bg-white">
        <h2 className="text-lg font-semibold mb-4">
          Videos qualifiees concurrentes
        </h2>
        {topic.competitors.length === 0 ? (
          <p className="text-sm text-gray-400">
            Aucune video qualifiee trouvee pour ce sujet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4 font-medium">Titre</th>
                  <th className="py-2 pr-4 font-medium">Chaine</th>
                  <th className="py-2 pr-4 font-medium text-right">Vues</th>
                  <th className="py-2 font-medium text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {topic.competitors.map((v) => (
                  <tr key={v.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <a
                        href={`https://youtube.com/watch?v=${v.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {v.title}
                      </a>
                    </td>
                    <td className="py-2 pr-4 text-gray-500 text-xs">
                      {v.channelTitle}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">
                      {formatViews(v.views)}
                    </td>
                    <td className="py-2 text-right text-gray-400 text-xs">
                      {new Date(v.publishedAt).toLocaleDateString('fr-FR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Frustrated comments */}
      <div className="border rounded-lg p-4 md:p-6 bg-white">
        <h2 className="text-lg font-semibold mb-4">
          Commentaires frustres ({topic.frustrations.length})
        </h2>
        {topic.frustrations.length === 0 ? (
          <p className="text-sm text-gray-400">
            Aucun commentaire de frustration detecte.
          </p>
        ) : (
          <div className="space-y-3">
            {topic.frustrations.map((f) => (
              <div
                key={f.commentId}
                className="border rounded p-3 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-gray-800 whitespace-pre-wrap break-words flex-1">
                    {f.text}
                  </p>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${LABEL_COLORS[f.label] ?? 'bg-gray-100'}`}
                    >
                      {LABEL_NAMES[f.label] ?? f.label}
                    </span>
                    <span className="text-xs text-gray-400">
                      {f.likeCount} like{f.likeCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {f.requestedAngle && (
                  <p className="mt-1 text-xs text-indigo-600 italic">
                    Angle : {f.requestedAngle}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Angles */}
      <div className="border rounded-lg p-4 md:p-6 bg-white">
        <h2 className="text-lg font-semibold mb-4">Angles de contenu</h2>
        {topic.angles.length === 0 ? (
          <p className="text-sm text-gray-400">
            Aucun angle genere pour ce sujet. La generation d&apos;angles sera
            disponible prochainement.
          </p>
        ) : (
          <div className="space-y-3">
            {topic.angles.map((a) => (
              <div key={a.id} className="border rounded p-3">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-medium text-sm">{a.title}</h3>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                    {a.status}
                  </span>
                </div>
                {a.hook && (
                  <p className="text-sm text-gray-600 italic">{a.hook}</p>
                )}
                {a.rationale && (
                  <p className="text-xs text-gray-400 mt-1">{a.rationale}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
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
    <div
      className={`border rounded-lg p-3 text-center ${
        highlight ? 'bg-indigo-50 border-indigo-200' : 'bg-white'
      }`}
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={`text-xl font-bold mt-1 ${
          highlight ? 'text-indigo-700' : 'text-gray-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
