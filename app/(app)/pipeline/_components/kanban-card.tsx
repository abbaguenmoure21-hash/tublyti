'use client';

import { useDraggable } from '@dnd-kit/core';
import Link from 'next/link';
import { Copy, Check, TrendingUp, TrendingDown, ArrowRightLeft } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { PipelineCard, PipelineColumn } from '../page';
import { PHASE_LABELS, PhaseBadge } from '@/components/tublyti';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { COLUMNS } from './columns';

const ratioFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const viewsFormat = new Intl.NumberFormat('fr-FR');

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

/** Keeps clicks, touches and keys on inner controls from starting a drag. */
const stopDrag = {
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onMouseDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

export function KanbanCardComponent({
  card,
  column,
  onMove,
  isDragging = false,
}: {
  card: PipelineCard;
  column?: PipelineColumn;
  onMove?: (cardId: string, target: PipelineColumn) => void;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform } = useDraggable({
    id: card.angleId,
    disabled: column === 'measured',
  });
  const [copied, setCopied] = useState(false);

  const age = daysSince(card.createdAt);
  const phaseLabel = PHASE_LABELS[card.phase] ?? 'Inconnue';

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  // « Passer à » targets: every column but the current one and « Mesurée » (automatic).
  const targets = column && column !== 'measured' && onMove
    ? COLUMNS.filter((c) => c.id !== column && c.id !== 'measured')
    : [];

  async function handleCopyBrief() {
    const brief = [
      `# Résumé — ${card.angleTitle}`,
      '',
      `**Sujet :** ${card.topicLabel}`,
      `**Thématique :** ${card.nicheName}`,
      `**Moment :** ${phaseLabel}`,
      card.mgi ? `**Potentiel :** ${Math.round(card.mgi)}/100` : '',
      '',
      `## Angle`,
      '',
      `**Titre :** ${card.angleTitle}`,
      card.angleHook ? `**Accroche :** ${card.angleHook}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      toast.success('Résumé copié.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Impossible de copier le résumé. Réessaie.');
    }
  }

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
      }}
      style={style}
      {...listeners}
      {...attributes}
      aria-roledescription="vidéo déplaçable"
      aria-label={card.angleTitle}
      className={`group elev-1 rounded-2xl bg-card p-4 outline-none transition-shadow hover:elev-2 focus-visible:ring-3 focus-visible:ring-ring/50 ${
        column === 'measured' ? '' : 'cursor-grab active:cursor-grabbing'
      } ${isDragging ? 'elev-3 ring-1 ring-primary/30' : ''}`}
    >
      {/* Topic label + phase */}
      <div className="mb-2 flex items-center gap-2">
        <PhaseBadge phase={card.phase} />
        <Link
          href={`/topics/${card.topicId}`}
          {...stopDrag}
          className="truncate text-[13px] text-muted-foreground transition-colors hover:text-primary"
        >
          {card.topicLabel}
        </Link>
      </div>

      {/* Angle title */}
      <p className="mb-3 line-clamp-3 text-[15px] font-semibold leading-snug text-foreground">
        {card.angleTitle}
      </p>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
        <span className="max-w-[140px] truncate font-medium text-foreground">{card.channelName || card.nicheName}</span>
        <span aria-hidden="true">·</span>
        <span className="whitespace-nowrap tabular-nums">{age === 0 ? 'Ajoutée aujourd’hui' : age === 1 ? 'Depuis hier' : `Depuis ${age} jours`}</span>

        {card.mgi !== null && card.mgi > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">Potentiel {Math.round(card.mgi)}</span>
          </>
        )}
      </div>

      {/* Results: neutral view count while young, ratio to usual views once measured (30 d+) */}
      {column === 'measured' && card.viewsVsUsual !== null ? (
        <div className={`mt-3 flex items-center gap-1.5 text-[12px] font-semibold ${
          card.viewsVsUsual >= 1 ? 'text-phase-2-ink' : 'text-muted-foreground'
        }`}>
          {card.viewsVsUsual >= 1 ? (
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <TrendingDown className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="tabular-nums text-mono-metric">
            ×{ratioFormat.format(card.viewsVsUsual)} tes vues habituelles
          </span>
        </div>
      ) : card.views !== null && card.publishedDaysAgo !== null ? (
        <p className="mt-3 text-[12px] tabular-nums text-muted-foreground">
          {viewsFormat.format(card.views)} vues en {Math.max(1, card.publishedDaysAgo)} j
        </p>
      ) : null}

      {/* Actions: always visible on touch screens, on hover/focus from md up */}
      {!isDragging && (
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:has-[[data-popup-open]]:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleCopyBrief();
            }}
            {...stopDrag}
            className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} h-10 rounded-full text-muted-foreground md:h-7`}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? 'Copié' : 'Copier le résumé'}
          </button>

          {targets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                {...stopDrag}
                aria-label={`Passer « ${card.angleTitle} » à une autre colonne`}
                className={`${buttonVariants({ variant: 'outline', size: 'sm' })} h-10 rounded-full md:h-7`}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Passer à
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-44">
                <DropdownMenuLabel>Passer à</DropdownMenuLabel>
                {targets.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    className="min-h-10 md:min-h-8"
                    onClick={() => onMove?.(card.angleId, t.id)}
                  >
                    <t.icon aria-hidden="true" />
                    {t.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
}
