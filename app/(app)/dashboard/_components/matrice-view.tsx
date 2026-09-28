'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { PhaseBadge, phaseColor } from '@/components/tublyti';
import { FeasibilityBadge } from '@/components/tublyti/feasibility-badge';
import type { FeasibilityGrade } from '@/lib/scoring/feasibility';
import { TopicPreview } from './topic-preview';

interface TopicRow {
  id: string;
  label: string;
  mgi: number;
  demand: number;
  frustration: number;
  supplyQ: number;
  monetization: number;
  phase: number;
  feasibilityGrade: string | null;
  sparkline: number[];
  topQuote: string | null;
  rank: number;
  totalInNiche: number;
}

function mgiColor(v: number): string {
  if (v >= 80) return '#443cc6';
  if (v >= 60) return '#646cd8';
  if (v >= 40) return '#8c97e9';
  return '#b7c0f8';
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-muted-foreground">—</span>;
  const max = Math.max(...values) || 1;
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 72;
  const h = 20;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const trend = values[values.length - 1] - values[0];
  const color = trend >= 0 ? 'var(--phase-2)' : 'var(--phase-3)';

  return (
    <svg width={w} height={h}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ScatterPlot({
  topics,
  selectedId,
  onSelect,
}: {
  topics: TopicRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const W = 760;
  const H = 460;
  const L = 56;
  const T = 20;
  const R = 720;
  const B = 390;

  const xMax = 12;
  const yMax = 100;

  function toX(supply: number): number {
    return L + (Math.min(supply, xMax) / xMax) * (R - L);
  }
  function toY(demand: number): number {
    return B - (Math.min(demand, yMax) / yMax) * (B - T);
  }

  return (
    <section className="flex-1 bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-4 pr-4 pb-2 pl-2">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Matrice demande / offre qualifiée">
        {/* Blue ocean quadrant */}
        <rect x={L} y={T} width={161} height={148} className="fill-primary-soft" />
        <text x={L + 10} y={T + 20} fontSize={12} fontWeight={600} className="fill-primary-ink">
          OCÉAN BLEU
        </text>

        {/* Grid */}
        <g stroke="var(--border)" strokeDasharray="3 4">
          {[T, 112, 205, 297].map((y) => (
            <line key={`h${y}`} x1={L} y1={y} x2={R} y2={y} />
          ))}
          {[217, 378, 539, 700].map((x) => (
            <line key={`v${x}`} x1={x} y1={T} x2={x} y2={B} />
          ))}
        </g>
        <line x1={L} y1={B} x2={R} y2={B} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
        <line x1={L} y1={T} x2={L} y2={B} stroke="var(--muted-foreground)" strokeOpacity={0.4} />

        {/* Y axis labels */}
        <g fontSize={12} className="fill-muted-foreground" fontFamily="inherit">
          <text x={46} y={B + 4} textAnchor="end">0</text>
          <text x={46} y={301} textAnchor="end">25</text>
          <text x={46} y={209} textAnchor="end">50</text>
          <text x={46} y={116} textAnchor="end">75</text>
          <text x={46} y={24} textAnchor="end">100</text>
        </g>
        {/* X axis labels */}
        <g fontSize={12} className="fill-muted-foreground" fontFamily="inherit">
          <text x={L} y={410} textAnchor="middle">0</text>
          <text x={217} y={410} textAnchor="middle">3</text>
          <text x={378} y={410} textAnchor="middle">6</text>
          <text x={539} y={410} textAnchor="middle">9</text>
          <text x={700} y={410} textAnchor="middle">12+</text>
        </g>
        {/* Axis titles */}
        <text x={388} y={440} textAnchor="middle" fontWeight={500} fontSize={12} className="fill-foreground">
          Offre qualifiée · vidéos de qualité publiées sur 180 jours
        </text>
        <text x={14} y={205} textAnchor="middle" fontWeight={500} fontSize={12} className="fill-foreground" transform="rotate(-90 14 205)">
          Demande (0–100)
        </text>

        {/* Data points */}
        <g fillOpacity={0.85} stroke="white" strokeWidth={1.5}>
          {topics.map((t) => {
            const cx = toX(t.supplyQ);
            const cy = toY(t.demand);
            const r = Math.max(5, Math.min(16, t.frustration * 30));
            const isSelected = t.id === selectedId;
            return (
              <g key={t.id} onClick={() => onSelect(t.id)} className="cursor-pointer">
                {isSelected && (
                  <circle cx={cx} cy={cy} r={r + 6} fill="none" stroke="var(--primary)" strokeWidth={2} />
                )}
                <circle cx={cx} cy={cy} r={r} fill={phaseColor(t.phase)} />
              </g>
            );
          })}
        </g>

        {/* Selected tooltip */}
        {selectedId && (() => {
          const t = topics.find((t) => t.id === selectedId);
          if (!t) return null;
          const cx = toX(t.supplyQ);
          const cy = toY(t.demand);
          const labelText = `${t.label} · ${Math.round(t.mgi)}`;
          const tw = Math.min(labelText.length * 7 + 20, 260);
          const tx = Math.min(cx + 20, R - tw);
          const ty = cy - 14;
          return (
            <g>
              <rect x={tx} y={ty} width={tw} height={28} rx={6} className="fill-foreground" />
              <text x={tx + 12} y={ty + 18} fontSize={12} className="fill-card" fontFamily="inherit">
                {labelText}
              </text>
            </g>
          );
        })()}
      </svg>
    </section>
  );
}

export function MatriceView({ topics }: { topics: TopicRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const previewTopics = topics.map((t, i) => ({
    ...t,
    rank: i + 1,
    totalInNiche: topics.length,
  }));

  return (
    <>
      {/* Chart + Preview side by side */}
      <div className="flex gap-4">
        <ScatterPlot topics={topics} selectedId={selectedId} onSelect={handleSelect} />
        <div className="hidden lg:block">
          <TopicPreview topics={previewTopics} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>

      {/* Table */}
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] overflow-hidden">
        {/* Header */}
        <div
          className="grid h-10 items-center px-[18px] bg-background border-b border-border text-[12px] font-medium text-muted-foreground"
          style={{ gridTemplateColumns: '2.4fr 1.2fr 1fr 0.5fr 0.8fr 0.9fr 0.9fr 1fr' }}
        >
          <span>Sujet</span>
          <span>Phase</span>
          <span>MGI ↓</span>
          <span>Fais.</span>
          <span>Demande</span>
          <span>Offre</span>
          <span>Frustration</span>
          <span>Tendance 30 j</span>
        </div>
        {/* Rows */}
        {topics.map((t) => (
          <Link
            key={t.id}
            href={`/topics/${t.id}`}
            onClick={(e) => {
              // Click selects in the preview, Ctrl/Cmd+click navigates
              if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                handleSelect(t.id);
              }
            }}
            className={`grid h-11 items-center px-[18px] border-b border-muted text-[14px] text-foreground transition-colors hover:bg-muted/50 ${
              t.id === selectedId ? 'bg-primary-soft/50' : ''
            }`}
            style={{ gridTemplateColumns: '2.4fr 1.2fr 1fr 0.5fr 0.8fr 0.9fr 0.9fr 1fr' }}
          >
            <span className="font-medium truncate">{t.label}</span>
            <span><PhaseBadge phase={t.phase} /></span>
            <span className="flex items-center gap-2">
              <span className="font-semibold tabular-nums w-[22px]">{Math.round(t.mgi)}</span>
              <span className="w-11 h-1.5 rounded-full bg-muted block overflow-hidden">
                <span
                  className="block h-1.5 rounded-full"
                  style={{ width: `${Math.min(t.mgi, 100)}%`, backgroundColor: mgiColor(t.mgi) }}
                />
              </span>
            </span>
            <span>{t.feasibilityGrade ? <FeasibilityBadge grade={t.feasibilityGrade as FeasibilityGrade} /> : <span className="text-muted-foreground">—</span>}</span>
            <span className="tabular-nums text-muted-foreground">{Math.round(t.demand)}</span>
            <span className="tabular-nums text-muted-foreground">{t.supplyQ}</span>
            <span className="tabular-nums text-muted-foreground">{Math.round(t.frustration * 100)} %</span>
            <span><Sparkline values={t.sparkline} /></span>
          </Link>
        ))}
        {topics.length === 0 && (
          <div className="px-[18px] py-8 text-center text-[14px] text-muted-foreground">
            Aucun sujet ne correspond aux filtres sélectionnés.
          </div>
        )}
      </section>
    </>
  );
}
