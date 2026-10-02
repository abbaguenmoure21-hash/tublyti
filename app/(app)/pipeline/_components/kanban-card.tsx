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
      className={`group bg-white/70 dark:bg-[#12141A]/70 backdrop-blur-xl border border-black/5 dark:border-white/10 rounded-[20px] p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] cursor-grab active:cursor-grabbing transition-all hover:border-primary/20 ${
        isDragging ? 'shadow-[0_16px_32px_rgba(0,0,0,0.12)] ring-1 ring-primary/30 rotate-2' : ''
      }`}
    >
      {/* Topic label + phase */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full shadow-[0_0_4px_currentColor] opacity-80 bg-phase-${card.phase}`} />
        <Link
          href={`/topics/${card.topicId}`}
          onClick={(e) => e.stopPropagation()}
          className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/80 hover:text-primary truncate transition-colors"
        >
          {card.topicLabel}
        </Link>
      </div>

      {/* Angle title */}
      <p className="text-[15px] font-bold leading-[1.3] line-clamp-3 mb-3 text-foreground group-hover:text-primary transition-colors">
        {card.angleTitle}
      </p>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground/80 flex-wrap">
        <span className="truncate max-w-[120px]">{card.channelName || card.nicheName}</span>
        <span className="text-black/10 dark:text-white/10">·</span>
        <span className="tabular-nums bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-md whitespace-nowrap">J+{age}</span>

        {card.mgi !== null && (
          <>
            <span className="text-black/10 dark:text-white/10">·</span>
            <span className="tabular-nums text-mono-metric">MGI {Math.round(card.mgi)}</span>
          </>
        )}
      </div>

      {/* Performance (only for measured cards) */}
      {card.performanceVsMedian !== null && (
        <div className={`flex items-center gap-1.5 mt-3 text-[12px] font-bold ${
          card.performanceVsMedian >= 0 ? 'text-[#30D158]' : 'text-[#FF453A]'
        }`}>
          {card.performanceVsMedian >= 0 ? (
            <TrendingUp className="w-4 h-4" />
          ) : (
            <TrendingDown className="w-4 h-4" />
          )}
          <span className="tabular-nums text-mono-metric">
            {card.performanceVsMedian >= 0 ? '+' : ''}
            {card.performanceVsMedian} % vs médiane
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
          {copied ? 'Copié' : 'Brief'}
        </button>
      </div>
    </div>
  );
}
