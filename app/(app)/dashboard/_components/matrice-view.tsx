'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { PhaseBadge, phaseColor, SparklineChart, SensitiveBadge } from '@/components/tublyti';
import { FeasibilityBadge } from '@/components/tublyti/feasibility-badge';
import type { FeasibilityGrade } from '@/lib/scoring/feasibility';
import { TopicPreview } from './topic-preview';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

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
  feasibilityReason: string | null;
  sparkline: number[];
  topQuote: string | null;
  rank: number;
  totalInNiche: number;
  sensitive?: boolean;
}

function mgiColor(v: number): string {
  if (v >= 80) return '#30D158';
  if (v >= 60) return '#0A84FF';
  if (v >= 40) return '#FF9F0A';
  return '#FF453A';
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
    <section className="flex-1 bento-card !p-4 !pr-4 !pb-2 !pl-2">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Matrice demande / offre qualifiée">
        {/* Blue ocean quadrant — glass effect */}
        <defs>
          <linearGradient id="ocean-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#30D158" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#0A84FF" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <rect x={L} y={T} width={161} height={148} fill="url(#ocean-gradient)" rx="8" />
        <text x={L + 10} y={T + 20} fontSize={11} fontWeight={600} fill="#30D158" opacity={0.8}>
          OCÉAN BLEU
        </text>

        {/* Grid — subtle dashed lines */}
        <g stroke="var(--border)" strokeDasharray="3 4" opacity={0.5}>
          {[T, 112, 205, 297].map((y) => (
            <line key={`h${y}`} x1={L} y1={y} x2={R} y2={y} />
          ))}
          {[217, 378, 539, 700].map((x) => (
            <line key={`v${x}`} x1={x} y1={T} x2={x} y2={B} />
          ))}
        </g>
        <line x1={L} y1={B} x2={R} y2={B} stroke="var(--muted-foreground)" strokeOpacity={0.25} />
        <line x1={L} y1={T} x2={L} y2={B} stroke="var(--muted-foreground)" strokeOpacity={0.25} />

        {/* Y axis labels */}
        <g fontSize={11} fill="var(--muted-foreground)" fontFamily="inherit" opacity={0.7}>
          <text x={46} y={B + 4} textAnchor="end">0</text>
          <text x={46} y={301} textAnchor="end">25</text>
          <text x={46} y={209} textAnchor="end">50</text>
          <text x={46} y={116} textAnchor="end">75</text>
          <text x={46} y={24} textAnchor="end">100</text>
        </g>
        {/* X axis labels */}
        <g fontSize={11} fill="var(--muted-foreground)" fontFamily="inherit" opacity={0.7}>
          <text x={L} y={410} textAnchor="middle">0</text>
          <text x={217} y={410} textAnchor="middle">3</text>
          <text x={378} y={410} textAnchor="middle">6</text>
          <text x={539} y={410} textAnchor="middle">9</text>
          <text x={700} y={410} textAnchor="middle">12+</text>
        </g>
        {/* Axis titles */}
        <text x={388} y={440} textAnchor="middle" fontWeight={500} fontSize={11} fill="var(--muted-foreground)">
          Offre qualifiée · vidéos publiées sur 180 jours
        </text>
        <text x={14} y={205} textAnchor="middle" fontWeight={500} fontSize={11} fill="var(--muted-foreground)" transform="rotate(-90 14 205)">
          Demande (0–100)
        </text>

        {/* Data points — animated bubbles with phase colors */}
        <g fillOpacity={0.75}>
          {topics.map((t, i) => {
            // Hash string for deterministic jitter
            let hash = 0;
            for (let j = 0; j < t.id.length; j++) {
              hash = (hash << 5) - hash + t.id.charCodeAt(j);
              hash |= 0;
            }
            const randX = Math.abs(hash % 100) / 100;
            const randY = Math.abs((hash >> 8) % 100) / 100;
            
            // Jitter X by roughly ±0.4, but if supplyQ is 0, jitter strictly positively 0 to +0.6
            const jitterX = t.supplyQ === 0 ? randX * 0.6 : randX * 0.8 - 0.4;
            // Jitter Y by ±3
            const jitterY = randY * 6 - 3;

            const plottedSupply = Math.max(0, t.supplyQ + jitterX);
            const plottedDemand = Math.max(0, Math.min(100, t.demand + jitterY));

            const cx = toX(plottedSupply);
            const cy = toY(plottedDemand);
            const r = 7; // Taille fixe et uniforme pour tous les points
            const isSelected = t.id === selectedId;
            const color = phaseColor(t.phase);
            return (
              <g key={t.id} onClick={() => onSelect(t.id)} className="cursor-pointer">
                {/* Selection ring */}
                {isSelected && (
                  <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke="var(--primary)" strokeWidth={2} opacity={0.6} />
                )}
                {/* Glow halo */}
                <circle cx={cx} cy={cy} r={r + 3} fill={color} opacity={isSelected ? 0.2 : 0.08} />
                {/* Main bubble */}
                <motion.circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={color}
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth={1}
                  initial={{ r: 0, opacity: 0 }}
                  animate={{ r, opacity: 1 }}
                  transition={{
                    type: 'spring',
                    stiffness: 300,
                    damping: 20,
                    delay: i * 0.02,
                  }}
                />
              </g>
            );
          })}
        </g>

        {/* Selected tooltip — glass effect */}
        {selectedId && (() => {
          const t = topics.find((t) => t.id === selectedId);
          if (!t) return null;
          
          let hash = 0;
          for (let j = 0; j < t.id.length; j++) {
            hash = (hash << 5) - hash + t.id.charCodeAt(j);
            hash |= 0;
          }
          const randX = Math.abs(hash % 100) / 100;
          const randY = Math.abs((hash >> 8) % 100) / 100;
          const jitterX = t.supplyQ === 0 ? randX * 0.6 : randX * 0.8 - 0.4;
          const jitterY = randY * 6 - 3;
          const plottedSupply = Math.max(0, t.supplyQ + jitterX);
          const plottedDemand = Math.max(0, Math.min(100, t.demand + jitterY));

          const cx = toX(plottedSupply);
          const cy = toY(plottedDemand);
          
          const tw = 220;
          const th = 52;
          const tx = Math.min(cx + 20, R - tw - 10);
          const ty = Math.max(cy - th / 2, T + 5);
          return (
            <g>
              <rect x={tx} y={ty} width={tw} height={th} rx={12} fill="var(--popover)" fillOpacity={0.9} stroke="var(--glass-border)" />
              <text x={tx + 12} y={ty + 18} fontSize={12} fontWeight={600} fill="var(--foreground)" fontFamily="inherit">
                {t.label.length > 28 ? t.label.slice(0, 28) + '…' : t.label}
              </text>
              <text x={tx + 12} y={ty + 36} fontSize={11} fill="var(--muted-foreground)" fontFamily="inherit">
                MGI {Math.round(t.mgi)} · D{Math.round(t.demand)} · O{t.supplyQ} · F{Math.round(t.frustration * 100)}%
              </text>
            </g>
          );
        })()}
      </svg>
    </section>
  );
}

export function MatriceView({ topics, selectedId, onSelect }: { topics: TopicRow[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const handleSelect = useCallback((id: string) => {
    onSelect(selectedId === id ? null : id);
  }, [selectedId, onSelect]);

  return (
    <div className="flex flex-col gap-6 min-w-0">
      <ScatterPlot topics={topics} selectedId={selectedId} onSelect={handleSelect} />

      {/* Table — premium glassmorphism */}
      <section className="bento-card !p-0 overflow-x-auto min-w-0 w-full">
        <div className="min-w-[800px] w-full">
          {/* Header */}
          <div
            className="grid h-11 items-center px-5 bg-[--bg-surface-1] border-b border-[--glass-border] text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
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
        <AnimatePresence>
          {topics.map((t, i) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.015, duration: 0.3 }}
            >
              <Link
                href={`/topics/${t.id}`}
                onClick={(e) => {
                  if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    handleSelect(t.id);
                  }
                }}
                className={`
                  grid h-12 items-center px-5 border-b border-[--glass-border]
                  text-[14px] text-foreground transition-all duration-150
                  hover:bg-[--bg-surface-1]
                  ${t.id === selectedId ? 'bg-primary/[0.06]' : ''}
                `}
                style={{ gridTemplateColumns: '2.4fr 1.2fr 1fr 0.5fr 0.8fr 0.9fr 0.9fr 1fr' }}
              >
                <span className="font-medium truncate flex items-center gap-1.5">
                  {t.label}
                  {t.sensitive && <SensitiveBadge />}
                </span>
                <span><PhaseBadge phase={t.phase} /></span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums text-mono-metric w-[22px]">{Math.round(t.mgi)}</span>
                  <span className="w-12 h-1.5 rounded-full bg-[--bg-surface-2] block overflow-hidden">
                    <motion.span
                      className="block h-1.5 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(t.mgi, 100)}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      style={{ backgroundColor: mgiColor(t.mgi) }}
                    />
                  </span>
                </span>
                <span>
                  {t.feasibilityGrade ? (
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-block cursor-help" />}>
                        <FeasibilityBadge grade={t.feasibilityGrade as FeasibilityGrade} />
                      </TooltipTrigger>
                      {t.feasibilityReason && (
                        <TooltipContent className="max-w-[280px] bg-popover/90 backdrop-blur-xl border-glass">
                          <p className="text-sm font-medium text-foreground">{t.feasibilityReason}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
                <span className="tabular-nums text-mono-metric text-muted-foreground">{Math.round(t.demand)}</span>
                <span className="tabular-nums text-mono-metric text-muted-foreground">{t.supplyQ}</span>
                <span className="tabular-nums text-mono-metric text-muted-foreground">{Math.round(t.frustration * 100)}%</span>
                <span>
                  <SparklineChart
                    data={t.sparkline}
                    width={72}
                    height={20}
                    color={t.sparkline.length >= 2 && t.sparkline[t.sparkline.length - 1] >= t.sparkline[0] ? 'var(--phase-2)' : 'var(--phase-3)'}
                    animate={false}
                  />
                </span>
              </Link>
            </motion.div>
          ))}
        </AnimatePresence>

          {topics.length === 0 && (
            <div className="px-5 py-10 text-center text-[14px] text-muted-foreground">
              Aucun sujet ne correspond aux filtres sélectionnés.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

