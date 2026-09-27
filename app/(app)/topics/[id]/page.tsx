'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { SignalChart } from '@/components/charts/signal-chart';

interface Topic {
  id: string;
  label: string;
  phase: number | null;
  status: string;
  niches: { name: string } | null;
}

interface DataPoint {
  date: string;
  value: number;
}

type SignalSeries = Record<string, DataPoint[]>;

const PHASE_LABELS: Record<number, string> = {
  0: 'Émergence',
  1: 'Viralité courte',
  2: 'Fenêtre idéale',
  3: 'Saturation',
};

export default function TopicPage() {
  const { id } = useParams<{ id: string }>();
  const [topic, setTopic] = useState<Topic | null>(null);
  const [signals, setSignals] = useState<SignalSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">Chargement...</div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">{error}</div>
    );
  }

  if (!topic) {
    return (
      <div className="p-8 text-center text-gray-500">Sujet introuvable.</div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <p className="text-sm text-gray-500">
          {topic.niches?.name ?? 'Niche inconnue'}
        </p>
        <h1 className="text-2xl font-bold mt-1">{topic.label}</h1>
        <div className="flex gap-3 mt-2">
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
            {topic.status}
          </span>
          {topic.phase !== null && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
              Phase {topic.phase} — {PHASE_LABELS[topic.phase] ?? '?'}
            </span>
          )}
        </div>
      </div>

      <div className="border rounded-lg p-6 bg-white">
        <h2 className="text-lg font-semibold mb-4">
          Signaux sur 90 jours
        </h2>
        {signals ? (
          <SignalChart series={signals} />
        ) : (
          <p className="text-sm text-gray-400">Aucune donnée disponible.</p>
        )}
      </div>
    </div>
  );
}
