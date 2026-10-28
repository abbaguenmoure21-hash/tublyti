'use client';

import { useDraggable } from '@dnd-kit/core';
import Link from 'next/link';
import { Copy, Check, TrendingUp, TrendingDown } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { PipelineCard } from '../page';
import { PHASE_LABELS } from '@/components/tublyti/phase-badge';

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

export function KanbanCardComponent({
  card,
  isDragging = false,
}: {
  card: PipelineCard;
  isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: card.angleId,
  });
  const [copied, setCopied] = useState(false);

  const age = daysSince(card.createdAt);
  const phaseLabel = PHASE_LABELS[card.phase] ?? 'Inconnue';

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  async function handleCopyBrief() {
    const brief = [
      `# Brief — ${card.angleTitle}`,
      '',
      `**Sujet :** ${card.topicLabel}`,
      `**Niche :** ${card.nicheName}`,
      `**Phase :** ${phaseLabel}`,
      card.mgi ? `**Potentiel :** ${Math.round(card.mgi)}/100` : '',
      '',
      `## Angle`,
      '',
      `**Titre :** ${card.angleTitle}`,
      card.angleHook ? `**Hook :** ${card.angleHook}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    await navigator.clipboard.writeText(brief);
    setCopied(true);
    toast.success('Brief copié.');
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`group elev-1 cursor-grab rounded-2xl bg-card p-4 transition-shadow hover:elev-2 active:cursor-grabbing ${
        isDragging ? 'elev-3 ring-1 ring-primary/30' : ''
      }`}
    >
      {/* Topic label + phase */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-2 w-2 shrink-0 rounded-full bg-phase-${card.phase}`} aria-hidden="true" />
        <Link
          href={`/topics/${card.topicId}`}
          onClick={(e) => e.stopPropagation()}
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
        <span className="max-w-[140px] truncate font-medium text-foreground/80">{card.channelName || card.nicheName}</span>
        <span aria-hidden="true">·</span>
        <span className="whitespace-nowrap tabular-nums">{age === 0 ? 'Ajoutée aujourd’hui' : age === 1 ? 'Depuis hier' : `Depuis ${age} jours`}</span>

        {card.mgi !== null && card.mgi > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">Potentiel {Math.round(card.mgi)}</span>
          </>
        )}
      </div>

      {/* Performance (only for measured cards) */}
      {card.performanceVsMedian !== null && (
        <div className={`flex items-center gap-1.5 mt-3 text-[12px] font-bold ${
          card.performanceVsMedian >= 0 ? 'text-phase-2-ink' : 'text-destructive'
        }`}>
          {card.performanceVsMedian >= 0 ? (
            <TrendingUp className="w-4 h-4" />
          ) : (
            <TrendingDown className="w-4 h-4" />
          )}
          <span className="tabular-nums text-mono-metric">
            {card.performanceVsMedian >= 0 ? '+' : ''}
            {card.performanceVsMedian} % par rapport à ta moyenne
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-black/5 dark:border-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleCopyBrief();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="haptic-btn h-7 px-3 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 shadow-sm rounded-full text-[12px] font-bold text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copié' : 'Copier le résumé'}
        </button>
      </div>
    </div>
  );
}
