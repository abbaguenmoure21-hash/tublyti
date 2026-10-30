'use client';

import Link from 'next/link';
import { useDroppable } from '@dnd-kit/core';
import type { LucideIcon } from 'lucide-react';
import type { PipelineCard, PipelineColumn } from '../page';
import { KanbanCardComponent } from './kanban-card';

const EMPTY_TEXT: Record<PipelineColumn, string> = {
  idea: '',
  in_production: 'Aucune vidéo en production',
  published: 'Aucune vidéo publiée en ce moment',
  measured: 'Les vidéos arrivent ici seules, 30 jours après leur publication',
};

export function KanbanColumn({
  id,
  label,
  icon: Icon,
  count,
  cards,
  onMove,
}: {
  id: PipelineColumn;
  label: string;
  icon: LucideIcon;
  count: number;
  cards: PipelineCard[];
  onMove?: (cardId: string, target: PipelineColumn) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label} (${count})`}
      className={`flex flex-col overflow-hidden rounded-2xl transition-all md:min-w-[260px] md:flex-1 ${
        isOver ? 'bg-primary-soft ring-1 ring-primary/20 elev-2' : 'well bg-muted/60'
      }`}
    >
      {/* Column header */}
      <div className="flex shrink-0 items-center gap-3 px-5 py-4">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{label}</h2>
        <span className="ml-auto rounded-full bg-card px-2.5 py-1 text-[12px] font-semibold tabular-nums text-muted-foreground">{count}</span>
      </div>

      {/* Cards */}
      <div className="hide-scrollbar flex-1 space-y-3 overflow-y-auto px-3 pb-4 pt-2">
        {cards.length === 0 && (
          <div className="mx-1 flex min-h-[96px] items-center justify-center rounded-2xl border border-dashed border-border px-4 text-center text-[13px] text-muted-foreground">
            {id === 'idea' ? (
              <span>
                Aucune idée en attente.{' '}
                <Link href="/sujets" className="font-medium text-primary hover:underline">
                  Choisir un sujet
                </Link>
              </span>
            ) : (
              EMPTY_TEXT[id]
            )}
          </div>
        )}
        {cards.map((card) => (
          <KanbanCardComponent key={card.angleId} card={card} column={id} onMove={onMove} />
        ))}
      </div>
    </section>
  );
}
