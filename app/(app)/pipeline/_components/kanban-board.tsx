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
      <header className="sticky top-0 z-20 h-[64px] shrink-0 flex items-center gap-4 px-6 md:px-8 border-b border-black/5 dark:border-white/10 bg-white/60 dark:bg-[#08090C]/60 backdrop-blur-2xl shadow-sm">
        <h1 className="text-[20px] font-bold text-foreground tracking-tight shrink-0">Pipeline</h1>

        {/* Niche filter */}
        {niches.length > 0 && (
          <div className="flex items-center gap-2 max-w-full">
            <div className="flex flex-wrap items-center gap-2 pb-1 -mb-1">
              <button
                type="button"
                onClick={() => router.push('/pipeline')}
                className={`haptic-btn whitespace-nowrap shrink-0 h-[32px] px-4 rounded-full text-[13px] font-bold transition-all cursor-pointer shadow-sm border ${
                  !activeNiche
                    ? 'bg-gradient-to-b from-primary to-blue-600 text-primary-foreground border-primary/20 shadow-[0_2px_8px_rgba(10,132,255,0.4)]'
                    : 'bg-white dark:bg-white/10 border-black/5 dark:border-white/10 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/20'
                }`}
              >
                Toutes
              </button>
              {visibleNiches.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => router.push(`/pipeline?niche=${n.id}`)}
                  className={`haptic-btn whitespace-nowrap shrink-0 h-[32px] px-4 rounded-full text-[13px] font-bold transition-all cursor-pointer shadow-sm border ${
                    activeNiche === n.id
                      ? 'bg-gradient-to-b from-primary to-blue-600 text-primary-foreground border-primary/20 shadow-[0_2px_8px_rgba(10,132,255,0.4)]'
                      : 'bg-white dark:bg-white/10 border-black/5 dark:border-white/10 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/20'
                  }`}
                >
                  {n.name}
                </button>
              ))}
            </div>

            <Dialog>
              <DialogTrigger
                className="haptic-btn flex-shrink-0 h-[32px] px-3.5 flex items-center gap-2 bg-white dark:bg-white/5 hover:bg-black/5 dark:hover:bg-white/10 text-foreground rounded-full font-bold text-[13px] transition-colors border border-black/5 dark:border-white/10 shadow-sm"
              >
                <LayoutGrid className="w-4 h-4 text-muted-foreground" />
                <span className="hidden sm:inline">Tout voir</span>
              </DialogTrigger>
              <DialogContent className="max-w-2xl bg-white/70 dark:bg-[#08090C]/70 backdrop-blur-2xl border-glass shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
                <DialogHeader>
                  <DialogTitle className="text-xl">Toutes les niches</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4 max-h-[60vh] overflow-y-auto pr-2 pb-2">
                  <button
                    type="button"
                    onClick={() => router.push('/pipeline')}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      !activeNiche
                        ? 'bg-primary/10 border-primary/20 font-bold text-primary'
                        : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground font-medium'
                    }`}
                  >
                    Toutes les niches
                  </button>
                  {niches.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => router.push(`/pipeline?niche=${n.id}`)}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        activeNiche === n.id
                          ? 'bg-primary/10 border-primary/20 font-bold text-primary'
                          : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground font-medium'
                      }`}
                    >
                      {n.name}
                    </button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </header>

      {/* Kanban */}
      <div className="flex-1 p-6 overflow-x-auto">
        {isMounted ? (
          <DndContext
            id={dndId}
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
        ) : (
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
