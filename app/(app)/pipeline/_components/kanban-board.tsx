'use client';

import { useState, useCallback, useTransition, useId, useEffect } from 'react';
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
import { LayoutGrid } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

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
  const dndId = useId();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const staticCount = 3;
  let visibleNiches = niches.slice(0, staticCount);
  if (activeNiche && !visibleNiches.find((n) => n.id === activeNiche)) {
    const selected = niches.find((n) => n.id === activeNiche);
    if (selected) {
      visibleNiches = [...niches.slice(0, staticCount - 1), selected];
    }
  }
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
      toast.error('Une vidéo passe seule dans « Mesurée » 30 jours après sa publication.');
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
      <header className="flex flex-col gap-1.5 px-4 pb-2 pt-5 md:px-8">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">Mes vidéos</h1>
        <p className="text-[15px] text-muted-foreground">
          Fais glisser chaque vidéo d’une colonne à l’autre, de l’idée à la mesure des résultats.
          {niches.length > 1 && !activeNiche ? ' Choisis une chaîne dans « Afficher » pour ne voir que la sienne.' : ''}
        </p>
      </header>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto px-4 pb-8 pt-2 md:px-8">
        {isMounted ? (
          <DndContext
            id={dndId}
            sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex min-h-[calc(100vh-200px)] gap-4">
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
        ) : (
          <div className="flex min-h-[calc(100vh-200px)] gap-4">
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
        )}
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
