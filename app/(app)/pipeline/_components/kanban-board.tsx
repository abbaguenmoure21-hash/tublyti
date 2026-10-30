'use client';

import { useState, useCallback, useTransition, useId } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  KeyboardCode,
  type Announcements,
  type DragStartEvent,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Clapperboard } from 'lucide-react';
import type { PipelineCard, PipelineColumn } from '../page';
import { KanbanColumn } from './kanban-column';
import { KanbanCardComponent } from './kanban-card';
import { PublishDialog } from './publish-dialog';
import { COLUMNS, COLUMN_LABEL } from './columns';
import { moveAngleToProduction, moveAngleToIdea, publishAngle } from '@/lib/actions/pipeline';
import { useMounted } from '@/hooks/use-mounted';
import { buttonVariants } from '@/components/ui/button';

/**
 * Keyboard: arrows jump from one column to the next (instead of 25 px steps),
 * so a card changes column with a single key press.
 */
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const { collisionRect, droppableRects } = context;
  if (!collisionRect) return undefined;
  const forward = event.code === KeyboardCode.Right || event.code === KeyboardCode.Down;
  const backward = event.code === KeyboardCode.Left || event.code === KeyboardCode.Up;
  if (!forward && !backward) return undefined;
  event.preventDefault();

  const order = COLUMNS.map((c) => c.id);
  const cx = collisionRect.left + collisionRect.width / 2;
  const cy = collisionRect.top + collisionRect.height / 2;
  // Current column = the one whose rect contains (or is closest to) the card center.
  let current = 0;
  let best = Infinity;
  order.forEach((id, i) => {
    const r = droppableRects.get(id);
    if (!r) return;
    const dx = Math.max(r.left - cx, 0, cx - (r.left + r.width));
    const dy = Math.max(r.top - cy, 0, cy - (r.top + r.height));
    const d = dx + dy;
    if (d < best) {
      best = d;
      current = i;
    }
  });
  const nextIndex = Math.min(order.length - 1, Math.max(0, current + (forward ? 1 : -1)));
  const target = droppableRects.get(order[nextIndex]);
  if (!target) return undefined;
  return {
    x: target.left + Math.max(0, (target.width - collisionRect.width) / 2),
    y: target.top + 56,
  };
};

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
  const [publishError, setPublishError] = useState<string | null>(null);
  const dndId = useId();
  // dnd-kit only on the client (avoids hydration mismatch on its aria ids).
  const isMounted = useMounted();

  // Server refresh (router.refresh) brings new props: keep local state in sync.
  const [prevInitial, setPrevInitial] = useState(initialColumns);
  if (prevInitial !== initialColumns) {
    setPrevInitial(initialColumns);
    setColumns(initialColumns);
  }

  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Long press on touch screens, so that a swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates }),
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

  const titleOf = useCallback(
    (angleId: string) => {
      for (const cards of Object.values(columns)) {
        const card = cards.find((c) => c.angleId === angleId);
        if (card) return `« ${card.angleTitle} »`;
      }
      return 'La vidéo';
    },
    [columns],
  );

  const announcements: Announcements = {
    onDragStart: ({ active }) => `${titleOf(String(active.id))} est prise. Flèches pour changer de colonne, Espace pour poser, Échap pour annuler.`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(String(active.id))} au-dessus de la colonne ${COLUMN_LABEL[over.id as PipelineColumn] ?? ''}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over ? `${titleOf(String(active.id))} posée dans ${COLUMN_LABEL[over.id as PipelineColumn] ?? ''}.` : `${titleOf(String(active.id))} reposée à sa place.`,
    onDragCancel: ({ active }) => `Déplacement annulé. ${titleOf(String(active.id))} reste à sa place.`,
  };

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

  /** Same rules for drag and drop, keyboard and the « Passer à » menu. */
  function moveCard(cardId: string, targetColumn: PipelineColumn) {
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
      setPublishError(null);
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
        // Undo only between Idée and En production (no server action to unpublish).
        const canUndo = sourceColumn === 'idea' || sourceColumn === 'in_production';
        toast.success(`Vidéo passée dans « ${COLUMN_LABEL[targetColumn]} ».`, canUndo
          ? { action: { label: 'Annuler', onClick: () => undoMove(card, sourceColumn) } }
          : undefined);
        router.refresh();
      }
    });
  }

  /**
   * Undo from the toast. Captures only the card and its former column, and uses
   * functional state updates: never relies on the (stale) columns of the render
   * where the move happened.
   */
  function undoMove(card: PipelineCard, backTo: 'idea' | 'in_production') {
    const relocate = (to: PipelineColumn, c: PipelineCard) =>
      setColumns((prev) => {
        const next = { ...prev };
        for (const col of Object.keys(next) as PipelineColumn[]) {
          next[col] = prev[col].filter((x) => x.angleId !== c.angleId);
        }
        next[to] = [c, ...next[to]];
        return next;
      });
    relocate(backTo, { ...card, status: backTo });
    startTransition(async () => {
      const result = backTo === 'idea' ? await moveAngleToIdea(card.angleId) : await moveAngleToProduction(card.angleId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Vidéo remise dans « ${COLUMN_LABEL[backTo]} ».`);
      }
      router.refresh();
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;
    moveCard(active.id as string, over.id as PipelineColumn);
  }

  function handlePublish(videoId: string) {
    if (!publishCard) return;

    const card = publishCard;
    const sourceColumn = findCardColumn(card.angleId);
    if (!sourceColumn) return;
    setPublishError(null);

    // Keep the dialog open while the video is checked; close only on success.
    startTransition(async () => {
      const result = await publishAngle(card.angleId, videoId);
      if (result.error) {
        setPublishError(result.error);
        return;
      }
      setColumns((prev) => {
        const next = { ...prev };
        next[sourceColumn] = prev[sourceColumn].filter((c) => c.angleId !== card.angleId);
        const updatedCard = { ...card, status: 'published' as const, videoId };
        next.published = [updatedCard, ...prev.published];
        return next;
      });
      setPublishCard(null);
      toast.success('Vidéo publiée enregistrée.');
      router.refresh();
    });
  }

  const totalCards = COLUMNS.reduce((n, c) => n + columns[c.id].length, 0);

  const board = (
    <div className="flex flex-col gap-4 md:min-h-[calc(100vh-200px)] md:flex-row">
      {COLUMNS.map((col) => (
        <KanbanColumn
          key={col.id}
          id={col.id}
          label={col.label}
          icon={col.icon}
          count={columns[col.id].length}
          cards={columns[col.id]}
          onMove={moveCard}
        />
      ))}
    </div>
  );

  return (
    <>
      <header className="flex flex-col gap-1.5 px-4 pb-2 pt-5 md:px-8">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">Mes vidéos</h1>
        <p className="text-[15px] text-muted-foreground">
          Fais avancer chaque vidéo de l’idée à la mesure des résultats : glisse-la d’une colonne à l’autre, ou utilise « Passer à » sur la carte.
          {niches.length > 1 && !activeNiche ? ' Choisis une chaîne dans « Afficher » pour ne voir que la sienne.' : ''}
        </p>
      </header>

      {totalCards === 0 ? (
        <div className="mx-4 mb-8 mt-2 flex flex-col items-center gap-3 rounded-2xl bg-card px-6 py-12 text-center elev-1 md:mx-8">
          <Clapperboard className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-[15px] font-semibold text-foreground">Aucune vidéo en cours</p>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            Choisis un sujet et clique sur « Créer cette vidéo » : elle arrivera ici, dans la colonne « Idée ».
          </p>
          <Link href="/sujets" className={buttonVariants({ size: 'lg' })}>
            Choisir un sujet
          </Link>
        </div>
      ) : (
        <div className="flex-1 px-4 pb-8 pt-2 md:overflow-x-auto md:px-8">
          {isMounted ? (
            <DndContext
              id={dndId}
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setActiveCard(null)}
              accessibility={{
                announcements,
                screenReaderInstructions: {
                  draggable:
                    'Pour déplacer la vidéo : Espace ou Entrée pour la prendre, flèches pour changer de colonne, Espace ou Entrée pour la poser, Échap pour annuler. Tu peux aussi utiliser le bouton « Passer à ».',
                },
              }}
            >
              {board}

              <DragOverlay>
                {activeCard && (
                  <div className="rotate-[2deg] opacity-90">
                    <KanbanCardComponent card={activeCard} isDragging />
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          ) : (
            board
          )}
        </div>
      )}

      {/* Publish dialog */}
      {publishCard && (
        <PublishDialog
          card={publishCard}
          open={!!publishCard}
          onOpenChange={(open) => {
            if (!open && !isPending) {
              setPublishCard(null);
              setPublishError(null);
            }
          }}
          onPublish={handlePublish}
          isPending={isPending}
          error={publishError}
        />
      )}
    </>
  );
}
