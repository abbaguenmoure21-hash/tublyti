'use client';

import { useEffect, useState, useCallback } from 'react';

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
    return (
      <div className="p-8 text-center text-gray-500">
        Chargement des sujets proposés...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">
        {error}
      </div>
    );
  }

  if (proposed.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <h1 className="text-2xl font-bold mb-4">Sujets à valider</h1>
        <p>
          Aucun sujet proposé pour le moment. Le clustering automatique
          proposera des sujets lors du prochain cycle de collecte.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Sujets à valider</h1>
        <span className="text-sm text-gray-500">
          {proposed.length} sujet{proposed.length > 1 ? 's' : ''} proposé
          {proposed.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-6">
        {proposed.map((topic) => {
          const isActing = acting?.topicId === topic.id;

          return (
            <div
              key={topic.id}
              className="border rounded-lg p-5 bg-white shadow-sm"
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h2 className="text-lg font-semibold">{topic.label}</h2>
                  {topic.niches && (
                    <span className="text-xs text-gray-500">
                      {topic.niches.name}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(topic.created_at).toLocaleDateString('fr-FR')}
                </span>
              </div>

              {topic.videos.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-gray-600 mb-2">
                    {topic.videos.length} vidéo{topic.videos.length > 1 ? 's' : ''} membre{topic.videos.length > 1 ? 's' : ''}
                  </h3>
                  <ul className="space-y-1 text-sm text-gray-700">
                    {topic.videos.slice(0, 10).map((v) => (
                      <li key={v.id} className="flex items-center gap-2">
                        <span className="text-gray-400">•</span>
                        <span className="truncate">{v.title}</span>
                        {v.channels && (
                          <span className="text-xs text-gray-400 shrink-0">
                            — {v.channels.title}
                          </span>
                        )}
                      </li>
                    ))}
                    {topic.videos.length > 10 && (
                      <li className="text-xs text-gray-400 italic">
                        et {topic.videos.length - 10} autre{topic.videos.length - 10 > 1 ? 's' : ''}...
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-3 border-t pt-3">
                <button
                  onClick={() => handleAction(topic.id, 'accept')}
                  disabled={isActing}
                  className="px-4 py-1.5 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 cursor-pointer"
                >
                  {isActing && acting?.action === 'accept'
                    ? 'Validation...'
                    : 'Accepter'}
                </button>

                <button
                  onClick={() => handleAction(topic.id, 'reject')}
                  disabled={isActing}
                  className="px-4 py-1.5 text-sm font-medium bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 cursor-pointer"
                >
                  {isActing && acting?.action === 'reject'
                    ? 'Rejet...'
                    : 'Rejeter'}
                </button>

                <div className="flex items-center gap-2 ml-auto">
                  <select
                    value={mergeSelection[topic.id] ?? ''}
                    onChange={(e) =>
                      setMergeSelection((prev) => ({
                        ...prev,
                        [topic.id]: e.target.value,
                      }))
                    }
                    className="border rounded px-2 py-1.5 text-sm max-w-[250px]"
                  >
                    <option value="">Fusionner avec...</option>
                    {mergeTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                        {t.niches ? ` (${t.niches.name})` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      const target = mergeSelection[topic.id];
                      if (!target) {
                        alert('Sélectionnez un sujet cible pour la fusion.');
                        return;
                      }
                      handleAction(topic.id, 'merge', target);
                    }}
                    disabled={isActing || !mergeSelection[topic.id]}
                    className="px-4 py-1.5 text-sm font-medium bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50 cursor-pointer"
                  >
                    {isActing && acting?.action === 'merge'
                      ? 'Fusion...'
                      : 'Fusionner'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
