'use client';

import { useState, useCallback, useTransition } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { PipelineCard, PipelineColumn } from '../page';
import { KanbanColumn } from './kanban-column';
import { KanbanCardComponent } from './kanban-card';
import { PublishDialog } from './publish-dialog';
import { moveAngleToProduction, moveAngleToIdea, publishAngle } from '@/lib/actions/pipeline';

const COLUMNS: { id: PipelineColumn; label: string; color: string }[] = [
  { id: 'idea', label: 'Idée', color: 'bg-phase-0' },
  { id: 'in_production', label: 'En production', color: 'bg-phase-1' },
  { id: 'published', label: 'Publiée', color: 'bg-phase-2' },
  { id: 'measured', label: 'Mesurée', color: 'bg-primary' },
];

export function KanbanBoard({
  columns: initialColumns,
  niches,
  activeNiche,
}: {
  columns: Record<PipelineColumn, PipelineCard[]>;
  niches: { id: string; name: string; channelName: string }[];
  activeNiche: string | null;
}) {
  const [columns, setColumns] = useState(initialColumns);
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);
  const [publishCard, setPublishCard] = useState<PipelineCard | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const findCardColumn = useCallback(
    (angleId: string): PipelineColumn | null => {
      for (const [col, cards] of Object.entries(columns)) {
        if (cards.some((c) => c.angleId === angleId)) {
          return col as PipelineColumn;
        }
      }
      return null;
    },
    [columns],
  );

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    for (const cards of Object.values(columns)) {
      const card = cards.find((c) => c.angleId === id);
      if (card) {
        setActiveCard(card);
        break;
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);

    const { active, over } = event;
    if (!over) return;

    const cardId = active.id as string;
    const targetColumn = over.id as PipelineColumn;
    const sourceColumn = findCardColumn(cardId);

    if (!sourceColumn || sourceColumn === targetColumn) return;

    // Can't move back from measured
    if (sourceColumn === 'measured') {
      toast.error('Impossible de retirer une vidéo mesurée.');
      return;
    }

    // Can't skip to measured
    if (targetColumn === 'measured') {
      toast.error('Le passage à « Mesurée » est automatique à J+30.');
      return;
    }

    const card = columns[sourceColumn].find((c) => c.angleId === cardId);
    if (!card) return;

    // Moving to published requires video ID
    if (targetColumn === 'published') {
      setPublishCard(card);
      return;
    }

    // Optimistic update
    setColumns((prev) => {
      const next = { ...prev };
      next[sourceColumn] = prev[sourceColumn].filter((c) => c.angleId !== cardId);
      const updatedCard = { ...card, status: targetColumn as 'idea' | 'in_production' | 'published' };
      next[targetColumn] = [updatedCard, ...prev[targetColumn]];
      return next;
    });

    // Server action
    startTransition(async () => {
      let result: { error?: string; success?: boolean };

      if (targetColumn === 'in_production') {
        result = await moveAngleToProduction(cardId);
      } else if (targetColumn === 'idea') {
        result = await moveAngleToIdea(cardId);
      } else {
        return;
      }

      if (result.error) {
        toast.error(result.error);
        // Revert
        setColumns((prev) => {
          const next = { ...prev };
          next[targetColumn] = prev[targetColumn].filter((c) => c.angleId !== cardId);
          next[sourceColumn] = [card, ...prev[sourceColumn]];
          return next;
        });
      } else {
        toast.success('Carte déplacée.');
        router.refresh();
      }
    });
  }

  function handlePublish(videoId: string) {
    if (!publishCard) return;

    const card = publishCard;
    const sourceColumn = findCardColumn(card.angleId);
    if (!sourceColumn) return;

    // Optimistic update
    setColumns((prev) => {
      const next = { ...prev };
      next[sourceColumn] = prev[sourceColumn].filter((c) => c.angleId !== card.angleId);
      const updatedCard = { ...card, status: 'published' as const, videoId };
      next.published = [updatedCard, ...prev.published];
      return next;
    });
    setPublishCard(null);

    startTransition(async () => {
      const result = await publishAngle(card.angleId, videoId);
      if (result.error) {
        toast.error(result.error);
        // Revert
        setColumns((prev) => {
          const next = { ...prev };
          next.published = prev.published.filter((c) => c.angleId !== card.angleId);
          if (sourceColumn) {
            next[sourceColumn] = [card, ...prev[sourceColumn]];
          }
          return next;
        });
      } else {
        toast.success('Vidéo publiée enregistrée.');
        router.refresh();
      }
    });
  }

  return (
    <>
      {/* Header */}
      <header className="h-[60px] shrink-0 flex items-center justify-between gap-4 px-8 border-b border-border bg-card">
        <h1 className="text-[18px] font-semibold">Pipeline</h1>

        {/* Niche filter */}
        {niches.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => router.push('/pipeline')}
              className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors cursor-pointer ${
                !activeNiche
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              Toutes
            </button>
            {niches.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => router.push(`/pipeline?niche=${n.id}`)}
                className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors cursor-pointer ${
                  activeNiche === n.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {n.channelName || n.name}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Kanban */}
      <div className="flex-1 p-6 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 min-h-[calc(100vh-160px)]">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                id={col.id}
                label={col.label}
                color={col.color}
                count={columns[col.id].length}
                cards={columns[col.id]}
              />
            ))}
          </div>

          <DragOverlay>
            {activeCard && (
              <div className="rotate-[2deg] opacity-90">
                <KanbanCardComponent card={activeCard} isDragging />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Publish dialog */}
      {publishCard && (
        <PublishDialog
          card={publishCard}
          open={!!publishCard}
          onOpenChange={(open) => !open && setPublishCard(null)}
          onPublish={handlePublish}
          isPending={isPending}
        />
      )}
    </>
  );
}
