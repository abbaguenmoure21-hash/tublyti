'use client';

import { useDroppable } from '@dnd-kit/core';
import type { PipelineCard, PipelineColumn } from '../page';
import { KanbanCardComponent } from './kanban-card';

export function KanbanColumn({
  id,
  label,
  color,
  count,
  cards,
}: {
  id: PipelineColumn;
  label: string;
  color: string;
  count: number;
  cards: PipelineCard[];
}) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-[280px] min-w-[280px] rounded-xl transition-colors ${
        isOver ? 'bg-primary-soft/40' : 'bg-muted/30'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <div className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{count}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto">
        {cards.length === 0 && (
          <div className="flex items-center justify-center h-20 rounded-lg border-2 border-dashed border-border/50 text-[12px] text-muted-foreground">
            Glisser une carte ici
          </div>
        )}
        {cards.map((card) => (
          <KanbanCardComponent key={card.angleId} card={card} />
        ))}
      </div>
    </div>
  );
}
