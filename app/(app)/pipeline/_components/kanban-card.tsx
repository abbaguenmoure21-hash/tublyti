'use client';

import { useDraggable } from '@dnd-kit/core';
import Link from 'next/link';
import { Copy, Check, TrendingUp, TrendingDown } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { PipelineCard } from '../page';
import { PHASE_LABELS } from '@/components/tublyti';

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
      card.mgi !== null ? `**MGI :** ${Math.round(card.mgi)}` : '',
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
      className={`bg-card border border-border rounded-lg p-3 shadow-[0_1px_2px_rgba(20,24,34,0.06)] cursor-grab active:cursor-grabbing transition-shadow hover:shadow-[0_2px_8px_rgba(20,24,34,0.08)] ${
        isDragging ? 'shadow-[0_8px_24px_rgba(20,24,34,0.12)]' : ''
      }`}
    >
      {/* Topic label + phase */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full bg-phase-${card.phase}`} />
        <Link
          href={`/topics/${card.topicId}`}
          onClick={(e) => e.stopPropagation()}
          className="text-[12px] text-muted-foreground hover:text-foreground truncate transition-colors"
        >
          {card.topicLabel}
        </Link>
      </div>

      {/* Angle title */}
      <p className="text-[13px] font-medium leading-snug line-clamp-2 mb-2">
        {card.angleTitle}
      </p>

      {/* Meta row */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{card.channelName || card.nicheName}</span>
        <span className="text-border">·</span>
        <span className="tabular-nums whitespace-nowrap">J+{age}</span>

        {card.mgi !== null && (
          <>
            <span className="text-border">·</span>
            <span className="tabular-nums">MGI {Math.round(card.mgi)}</span>
          </>
        )}
      </div>

      {/* Performance (only for measured cards) */}
      {card.performanceVsMedian !== null && (
        <div className={`flex items-center gap-1 mt-2 text-[12px] font-medium ${
          card.performanceVsMedian >= 0 ? 'text-phase-2' : 'text-destructive'
        }`}>
          {card.performanceVsMedian >= 0 ? (
            <TrendingUp className="w-3.5 h-3.5" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5" />
          )}
          <span className="tabular-nums">
            {card.performanceVsMedian >= 0 ? '+' : ''}
            {card.performanceVsMedian} % vs médiane
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/50">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleCopyBrief();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-6 px-2 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer flex items-center gap-1"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copié' : 'Brief'}
        </button>
      </div>
    </div>
  );
}
