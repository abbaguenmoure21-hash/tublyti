'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { PhaseBadge } from '@/components/tublyti';

interface TopicPreviewData {
  id: string;
  label: string;
  mgi: number;
  demand: number;
  supplyQ: number;
  frustration: number;
  monetization: number;
  phase: number;
  topQuote: string | null;
  rank: number;
  totalInNiche: number;
}

export function TopicPreview({
  topics,
  selectedId,
  onSelect,
}: {
  topics: TopicPreviewData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const topic = topics.find((t) => t.id === selectedId);

  if (!topic) {
    return (
      <aside className="w-[340px] shrink-0 bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5 flex flex-col items-center justify-center text-center gap-3">
        <p className="text-[14px] text-muted-foreground">
          Clique sur un point du graphique ou une ligne du tableau pour voir le détail.
        </p>
      </aside>
    );
  }

  const supplyLabel = topic.supplyQ === 1 ? '1 vidéo' : `${topic.supplyQ} vidéos`;

  return (
    <aside className="w-[340px] shrink-0 bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5 flex flex-col gap-4">
      {/* Phase + bookmark */}
      <div className="flex items-center justify-between">
        <PhaseBadge phase={topic.phase} />
        <button
          type="button"
          aria-label="Ajouter aux favoris"
          className="w-8 h-8 border border-border rounded-lg bg-card text-muted-foreground flex items-center justify-center hover:bg-muted transition-colors cursor-pointer"
        >
          <Star className="w-4 h-4" />
        </button>
      </div>

      {/* Title */}
      <h2 className="text-[20px] font-semibold leading-[1.25] tracking-[-0.01em]">
        {topic.label}
      </h2>

      {/* MGI big */}
      <div className="flex items-baseline gap-2">
        <span className="text-[40px] font-semibold tabular-nums tracking-[-0.02em]">
          {Math.round(topic.mgi)}
        </span>
        <span className="text-[14px] text-muted-foreground">
          MGI · top {topic.rank} de la niche
        </span>
      </div>

      {/* 4 mini-cards */}
      <div className="grid grid-cols-2 gap-2.5">
        <MiniStat label="Demande" value={String(Math.round(topic.demand))} />
        <MiniStat label="Offre qualifiée" value={supplyLabel} />
        <MiniStat label="Frustration" value={`${Math.round(topic.frustration * 100)} %`} />
        <MiniStat label="Monétisation" value={`× ${topic.monetization.toFixed(1)}`} />
      </div>

      {/* Quote */}
      {topic.topQuote && (
        <p className="text-[14px] leading-[1.5] text-muted-foreground">
          « {topic.topQuote} »
        </p>
      )}

      <div className="flex-1" />

      {/* Actions */}
      <Link
        href={`/topics/${topic.id}`}
        className="h-[38px] rounded-lg bg-primary text-primary-foreground text-[14px] font-medium flex items-center justify-center hover:bg-primary/90 transition-colors"
      >
        Ouvrir la fiche
      </Link>
      <button
        type="button"
        className="h-[38px] border border-border rounded-lg bg-card text-foreground text-[14px] font-medium hover:bg-muted transition-colors cursor-pointer"
      >
        Générer 5 angles
      </button>
    </aside>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background rounded-lg px-3 py-2.5 flex flex-col gap-0.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[17px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}
