'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface Niche {
  id: string;
  name: string;
}

interface TopicRow {
  id: string;
  label: string;
  status: string;
  nicheName: string;
  mgi: number;
  demand: number;
  frustration: number;
  supplyQ: number;
  monetization: number;
  phase: number;
  sparkline: number[];
}

const PHASE_COLORS: Record<number, string> = {
  0: '#22c55e', // green — emergence
  1: '#eab308', // yellow — short virality
  2: '#3b82f6', // blue — ideal window
  3: '#ef4444', // red — saturation
};

const PHASE_LABELS: Record<number, string> = {
  0: 'Emergence',
  1: 'Viralite courte',
  2: 'Fenetre ideale',
  3: 'Saturation',
};

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-gray-300">—</span>;
  const max = Math.max(...values) || 1;
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 60;
  const h = 20;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');

  const trend = values[values.length - 1] - values[0];
  const color = trend >= 0 ? '#22c55e' : '#ef4444';

  return (
    <svg width={w} height={h} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
      />
    </svg>
  );
}

export default function DashboardPage() {
  const [niches, setNiches] = useState<Niche[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [selectedNiche, setSelectedNiche] = useState('');
  const [blueOcean, setBlueOcean] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (nicheId: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = nicheId
        ? `/api/dashboard?niche=${nicheId}`
        : '/api/dashboard';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Erreur lors du chargement');
      const data = await res.json();
      setNiches(data.niches ?? []);
      setTopics(data.topics ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(selectedNiche);
  }, [fetchData, selectedNiche]);

  const filtered = useMemo(() => {
    if (!blueOcean) return topics;
    return topics.filter((t) => t.demand >= 60 && t.supplyQ <= 3);
  }, [topics, blueOcean]);

  // Scatter data
  const scatterData = useMemo(
    () =>
      filtered.map((t) => ({
        x: t.supplyQ,
        y: t.demand,
        z: Math.max(t.frustration * 200, 30), // min size for visibility
        phase: t.phase,
        label: t.label,
        mgi: t.mgi,
        id: t.id,
      })),
    [filtered],
  );

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        Chargement de la matrice...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">{error}</div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">Matrice d&apos;opportunites</h1>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedNiche}
            onChange={(e) => setSelectedNiche(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value="">Toutes les niches</option>
            {niches.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={blueOcean}
              onChange={(e) => setBlueOcean(e.target.checked)}
              className="rounded"
            />
            Ocean bleu
          </label>
          <span className="text-xs text-gray-400">
            {filtered.length} sujet{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {topics.length === 0 ? (
        <div className="text-center text-gray-500 py-12">
          <p>Aucun score disponible pour aujourd&apos;hui.</p>
          <p className="text-sm mt-1">
            Lancez le cron <code>score</code> pour calculer les MGI.
          </p>
        </div>
      ) : (
        <>
          {/* Scatter plot */}
          <div className="border rounded-lg p-4 bg-white mb-6">
            <div className="flex flex-wrap gap-4 mb-3 text-xs">
              {Object.entries(PHASE_LABELS).map(([p, label]) => (
                <div key={p} className="flex items-center gap-1.5">
                  <span
                    className="w-3 h-3 rounded-full inline-block"
                    style={{ backgroundColor: PHASE_COLORS[Number(p)] }}
                  />
                  {label}
                </div>
              ))}
              <span className="text-gray-400 ml-auto">
                Taille = frustration
              </span>
            </div>
            <ResponsiveContainer width="100%" height={350}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Offre qualifiee"
                  label={{
                    value: 'Offre qualifiee (O_q)',
                    position: 'insideBottom',
                    offset: -15,
                    style: { fontSize: 12 },
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Demande"
                  label={{
                    value: 'Demande (D)',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fontSize: 12 },
                  }}
                />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload || payload.length === 0) return null;
                    const d = payload[0].payload as (typeof scatterData)[0];
                    return (
                      <div className="bg-white border rounded px-3 py-2 shadow text-sm">
                        <p className="font-medium">{d.label}</p>
                        <p>MGI : {d.mgi.toFixed(1)}</p>
                        <p>Demande : {d.y.toFixed(0)}</p>
                        <p>Offre : {d.x.toFixed(1)}</p>
                        <p>Phase : {PHASE_LABELS[d.phase] ?? '?'}</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData}>
                  {scatterData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={PHASE_COLORS[entry.phase] ?? '#999'}
                      fillOpacity={0.7}
                      r={Math.sqrt(entry.z)}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="border rounded-lg bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-4 py-2.5 font-medium">Sujet</th>
                  <th className="px-4 py-2.5 font-medium text-right">MGI</th>
                  <th className="px-4 py-2.5 font-medium text-center">Phase</th>
                  <th className="px-4 py-2.5 font-medium text-right">Frustration</th>
                  <th className="px-4 py-2.5 font-medium text-right">Offre (O_q)</th>
                  <th className="px-4 py-2.5 font-medium text-center">Tendance 30 j</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/topics/${t.id}`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {t.label}
                      </Link>
                      <span className="block text-xs text-gray-400">
                        {t.nicheName}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">
                      {t.mgi.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: PHASE_COLORS[t.phase] ?? '#999' }}
                      >
                        {PHASE_LABELS[t.phase] ?? '?'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {(t.frustration * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {t.supplyQ.toFixed(1)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Sparkline values={t.sparkline} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
