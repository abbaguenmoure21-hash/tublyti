'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { BookmarkButton } from '@/components/bookmark-button';
import { markTopicProduction, markTopicPublished } from '@/lib/actions/topics';
import { generateAngles } from '@/lib/actions/angles';

const estimatedCost = (2000 * 3) / 1_000_000 + (1200 * 15) / 1_000_000;

export function TopicActions({
  topicId,
  status,
  isFavorite = false,
  canGenerate = false,
}: {
  topicId: string;
  status: string;
  isFavorite?: boolean;
  /** Génération d'angles (IA payante) : réservée à l'administration. */
  canGenerate?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [showPublishInput, setShowPublishInput] = useState(false);
  const [publishVideoId, setPublishVideoId] = useState('');

  function handleMarkProduction() {
    startTransition(async () => {
      const result = await markTopicProduction(topicId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success('Sujet marqué en production.');
    });
  }

  function handleMarkPublished() {
    startTransition(async () => {
      const result = await markTopicPublished(topicId, publishVideoId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setShowPublishInput(false);
      setPublishVideoId('');
      toast.success('Sujet marqué comme publié.');
    });
  }

  function handleGenerate() {
    startTransition(async () => {
      const result = await generateAngles(topicId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success('Angles générés.');
    });
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Bookmark */}
      <BookmarkButton itemType="topic" refId={topicId} initialSaved={isFavorite} />

      {/* Copy brief */}
      <button
        type="button"
        data-action="copy-brief"
        className="h-9 px-3.5 border border-border rounded-lg bg-card text-foreground text-[14px] font-medium hover:bg-muted transition-colors cursor-pointer"
      >
        Copier le brief
      </button>

      {/* Production / Publish */}
      {status === 'active' && (
        <button
          type="button"
          onClick={handleMarkProduction}
          disabled={isPending}
          className="h-9 px-3.5 border border-border rounded-lg bg-card text-foreground text-[14px] font-medium hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isPending ? 'Marquage…' : 'Passer en production'}
        </button>
      )}
      {status === 'in_production' && !showPublishInput && (
        <button
          type="button"
          onClick={() => setShowPublishInput(true)}
          className="h-9 px-3.5 border border-border rounded-lg bg-card text-foreground text-[14px] font-medium hover:bg-muted transition-colors cursor-pointer"
        >
          Marquer publiée
        </button>
      )}
      {showPublishInput && (
        <>
          <Input
            type="text"
            placeholder="ID vidéo YouTube"
            aria-label="Lien ou identifiant de la vidéo YouTube"
            value={publishVideoId}
            onChange={(e) => setPublishVideoId(e.target.value)}
            className="w-44 h-9"
          />
          <button
            type="button"
            onClick={handleMarkPublished}
            disabled={isPending || !publishVideoId.trim()}
            className="h-9 px-3.5 rounded-lg bg-phase-2 text-white text-[14px] font-medium hover:bg-phase-2/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            Confirmer
          </button>
          <button
            type="button"
            onClick={() => { setShowPublishInput(false); setPublishVideoId(''); }}
            className="h-9 px-2 text-[13px] text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Annuler
          </button>
        </>
      )}

      {/* Generate angles */}
      {canGenerate && (
      <button
        type="button"
        onClick={handleGenerate}
        disabled={isPending}
        className="h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[14px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
      >
        {isPending ? 'Génération…' : (
          <>
            Générer 5 angles{' '}
            <span className="opacity-75 font-normal">· {estimatedCost.toFixed(2)} $</span>
          </>
        )}
      </button>
      )}
    </div>
  );
}
