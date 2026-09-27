'use client';

import { useEffect, useState, useCallback } from 'react';

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

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        Chargement des frustrations...
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

  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <h1 className="text-2xl font-bold mb-4">Frustrations</h1>
        <p>
          Aucun commentaire classifié pour le moment. Lancez le cron{' '}
          <code>classify</code> pour analyser les commentaires.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Frustrations</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {filtered.length} commentaire{filtered.length > 1 ? 's' : ''}
          </span>
          <select
            value={filterNiche}
            onChange={(e) => setFilterNiche(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
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

      {[...grouped.entries()].map(([nicheName, videos]) => (
        <div key={nicheName} className="mb-8">
          <h2 className="text-lg font-semibold text-gray-700 mb-3 border-b pb-1">
            {nicheName}
          </h2>

          {[...videos.entries()].map(([videoKey, comments]) => (
            <div key={videoKey} className="mb-6 ml-2">
              <h3 className="text-sm font-medium text-gray-500 mb-2">
                {videoKey}
              </h3>

              <div className="space-y-2">
                {comments.map((item) => (
                  <div
                    key={item.commentId}
                    className="border rounded-lg p-4 bg-white hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                          {item.commentText}
                        </p>
                        {item.requestedAngle && (
                          <p className="mt-1 text-xs text-indigo-600 italic">
                            Angle : {item.requestedAngle}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${LABEL_COLORS[item.label] ?? 'bg-gray-100'}`}
                        >
                          {LABEL_NAMES[item.label] ?? item.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {item.likeCount} like{item.likeCount !== 1 ? 's' : ''}
                          {' · '}
                          {Math.round(item.confidence * 100)}%
                          {item.model === 'human' && ' · corrigé'}
                        </span>

                        {editing === item.commentId ? (
                          <div className="flex flex-wrap gap-1">
                            {ALL_LABELS.map((l) => (
                              <button
                                key={l}
                                onClick={() =>
                                  handleCorrect(item.commentId, l)
                                }
                                className={`text-xs px-2 py-0.5 rounded border cursor-pointer hover:ring-1 ${
                                  l === item.label
                                    ? 'ring-2 ring-blue-400'
                                    : ''
                                }`}
                              >
                                {LABEL_NAMES[l]}
                              </button>
                            ))}
                            <button
                              onClick={() => setEditing(null)}
                              className="text-xs text-gray-400 underline cursor-pointer"
                            >
                              annuler
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditing(item.commentId)}
                            className="text-xs text-blue-500 hover:underline cursor-pointer"
                          >
                            corriger
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
