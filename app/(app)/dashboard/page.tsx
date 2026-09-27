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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, AlertTriangle, Target, BarChart3 } from 'lucide-react';

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
  0: '#22c55e',
  1: '#eab308',
  2: '#6366f1',
  3: '#ef4444',
};

const PHASE_LABELS: Record<number, string> = {
  0: 'Emergence',
  1: 'Viralite courte',
  2: 'Fenetre ideale',
  3: 'Saturation',
};

const PHASE_BADGE_VARIANT: Record<number, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  0: 'outline',
  1: 'secondary',
  2: 'default',
  3: 'destructive',
};

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-muted-foreground">—</span>;
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

  const scatterData = useMemo(
    () =>
      filtered.map((t) => ({
        x: t.supplyQ,
        y: t.demand,
        z: Math.max(t.frustration * 200, 30),
        phase: t.phase,
        label: t.label,
        mgi: t.mgi,
        id: t.id,
      })),
    [filtered],
  );

  // Stats
  const stats = useMemo(() => {
    if (topics.length === 0) return null;
    const idealCount = topics.filter((t) => t.phase === 2).length;
    const avgMgi = topics.reduce((s, t) => s + t.mgi, 0) / topics.length;
    const highFrust = topics.filter((t) => t.frustration > 0.5).length;
    return { total: topics.length, idealCount, avgMgi, highFrust };
  }, [topics]);

  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <p className="text-destructive font-medium">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Matrice d&apos;opportunites</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Identifiez les sujets a fort potentiel avec le Market Gap Index
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedNiche}
            onChange={(e) => setSelectedNiche(e.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="">Toutes les niches</option>
            {niches.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <Button
            variant={blueOcean ? 'default' : 'outline'}
            size="sm"
            onClick={() => setBlueOcean(!blueOcean)}
            className="cursor-pointer"
          >
            <Target className="w-3.5 h-3.5" />
            Ocean bleu
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Sujets scores</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-500/10 text-blue-600">
                  <Target className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.idealCount}</p>
                  <p className="text-xs text-muted-foreground">Fenetre ideale</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-green-500/10 text-green-600">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.avgMgi.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">MGI moyen</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/10 text-amber-600">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.highFrust}</p>
                  <p className="text-xs text-muted-foreground">Haute frustration</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {topics.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Aucun score disponible pour aujourd&apos;hui.</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Lancez le cron <code className="bg-muted rounded px-1.5 py-0.5">score</code> pour calculer les MGI.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Scatter plot */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  Demande vs Offre
                  <span className="text-muted-foreground font-normal ml-2 text-sm">
                    {filtered.length} sujet{filtered.length !== 1 ? 's' : ''}
                  </span>
                </CardTitle>
                <div className="flex flex-wrap gap-3 text-xs">
                  {Object.entries(PHASE_LABELS).map(([p, label]) => (
                    <div key={p} className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block"
                        style={{ backgroundColor: PHASE_COLORS[Number(p)] }}
                      />
                      {label}
                    </div>
                  ))}
                  <span className="text-muted-foreground ml-2">
                    Taille = frustration
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Offre qualifiee"
                    label={{
                      value: 'Offre qualifiee (O_q)',
                      position: 'insideBottom',
                      offset: -15,
                      style: { fontSize: 12, fill: 'var(--color-muted-foreground)' },
                    }}
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="Demande"
                    label={{
                      value: 'Demande (D)',
                      angle: -90,
                      position: 'insideLeft',
                      style: { fontSize: 12, fill: 'var(--color-muted-foreground)' },
                    }}
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                  />
                  <Tooltip
                    content={({ payload }) => {
                      if (!payload || payload.length === 0) return null;
                      const d = payload[0].payload as (typeof scatterData)[0];
                      return (
                        <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
                          <p className="font-medium text-popover-foreground">{d.label}</p>
                          <p className="text-muted-foreground">MGI : {d.mgi.toFixed(1)}</p>
                          <p className="text-muted-foreground">Demande : {d.y.toFixed(0)}</p>
                          <p className="text-muted-foreground">Offre : {d.x.toFixed(1)}</p>
                          <p className="text-muted-foreground">Phase : {PHASE_LABELS[d.phase] ?? '?'}</p>
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
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Sujet</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">MGI</th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground">Phase</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Frustration</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Offre (O_q)</th>
                      <th className="px-4 py-3 text-center font-medium text-muted-foreground">Tendance 30 j</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/topics/${t.id}`}
                            className="text-primary hover:underline font-medium"
                          >
                            {t.label}
                          </Link>
                          <span className="block text-xs text-muted-foreground mt-0.5">
                            {t.nicheName}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {t.mgi.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            variant={PHASE_BADGE_VARIANT[t.phase] ?? 'secondary'}
                            className="text-[11px]"
                            style={
                              t.phase === 0
                                ? { borderColor: '#22c55e', color: '#16a34a' }
                                : t.phase === 1
                                  ? { backgroundColor: '#fef9c3', color: '#a16207', borderColor: '#fde047' }
                                  : undefined
                            }
                          >
                            {PHASE_LABELS[t.phase] ?? '?'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(t.frustration * 100).toFixed(0)}%
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {t.supplyQ.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Sparkline values={t.sparkline} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
