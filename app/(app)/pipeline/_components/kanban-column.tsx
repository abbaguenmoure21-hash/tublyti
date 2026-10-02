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
      className={`flex flex-col w-[320px] min-w-[320px] rounded-[28px] transition-all overflow-hidden ${
        isOver ? 'bg-primary/5 ring-1 ring-primary/20 shadow-[0_8px_30px_rgba(0,0,0,0.06)]' : 'bg-black/[0.02] dark:bg-white/[0.02]'
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-3 px-5 py-4 shrink-0">
        <div className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_currentColor] opacity-80 ${color}`} />
        <span className="text-[15px] font-bold tracking-tight text-foreground">{label}</span>
        <span className="ml-auto text-[12px] font-bold text-muted-foreground bg-black/5 dark:bg-white/10 px-2.5 py-1 rounded-full shadow-sm tabular-nums">{count}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 px-3 pt-2 pb-4 space-y-3 overflow-y-auto hide-scrollbar">
        {cards.length === 0 && (
          <div className="flex items-center justify-center h-[120px] rounded-[20px] border border-dashed border-black/10 dark:border-white/10 text-[13px] font-semibold text-muted-foreground/60 mx-1">
            Glisser une idée ici
          </div>
        )}
        {cards.map((card) => (
          <KanbanCardComponent key={card.angleId} card={card} />
        ))}
      </div>
    </div>
  );
}
