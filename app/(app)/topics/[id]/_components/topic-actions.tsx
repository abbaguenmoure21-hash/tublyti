'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { BookmarkButton } from '@/components/bookmark-button';
import { markTopicPublished } from '@/lib/actions/topics';
import { createVideoFromTopic, undoCreateVideo } from '@/lib/actions/sujets';
import { generateAngles } from '@/lib/actions/angles';
import { copyBrief, type BriefAngle, type BriefData } from './brief';

const estimatedCost = (2000 * 3) / 1_000_000 + (1200 * 15) / 1_000_000;

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return el.getAttribute('cmdk-input') !== null;
}

/**
 * Header actions of the topic page + keyboard shortcuts (C copy brief, P create video, A generate — admin).
 * « Créer cette vidéo » relies on the per-account state (inMyVideos), never on the shared topic status.
 */
export function TopicActions({
  topicId,
  topicLabel,
  inMyVideos,
  hasOpenVideo,
  isFavorite = false,
  canGenerate = false,
  briefAngle,
  briefData,
}: {
  topicId: string;
  topicLabel: string;
  /** The user already has a video on this topic. */
  inMyVideos: boolean;
  /** The user has a video in production on this topic (can be marked published). */
  hasOpenVideo: boolean;
  isFavorite?: boolean;
  /** Génération d'angles (IA payante) : réservée à l'administration. */
  canGenerate?: boolean;
  /** Angle used for the brief (chosen one, or the first proposed); null = topic brief. */
  briefAngle: BriefAngle | null;
  briefData: BriefData;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showPublishInput, setShowPublishInput] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');

  function handleCopyBrief() {
    void copyBrief(briefAngle, briefData);
  }

  function handleCreate() {
    if (isPending || inMyVideos) return;
    startTransition(async () => {
      const res = await createVideoFromTopic(topicId, briefAngle?.id ?? null);
      if ('error' in res && res.error) {
        toast.error(res.error);
        return;
      }
      const created = res as { videoId: string; existing?: boolean };
      if (created.existing) {
        toast('Ce sujet est déjà dans Mes vidéos', {
          action: { label: 'Ouvrir', onClick: () => router.push('/pipeline') },
        });
      } else {
        toast.success('Vidéo ajoutée à Mes vidéos', {
          description: topicLabel,
          action: { label: 'Annuler', onClick: () => void undoCreateVideo(created.videoId).then(() => router.refresh()) },
          cancel: { label: 'Ouvrir', onClick: () => router.push('/pipeline') },
        });
      }
      router.refresh();
    });
  }

  function handleMarkPublished() {
    startTransition(async () => {
      const result = await markTopicPublished(topicId, publishUrl);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setShowPublishInput(false);
      setPublishUrl('');
      toast.success('Vidéo marquée comme publiée.');
      router.refresh();
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

  // Latest handlers for the keyboard listener (avoids re-binding on every render).
  const handlers = useRef({ handleCopyBrief, handleCreate, handleGenerate });
  useEffect(() => {
    handlers.current = { handleCopyBrief, handleCreate, handleGenerate };
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;
      if (e.key === 'c') {
        e.preventDefault();
        handlers.current.handleCopyBrief();
      } else if (e.key === 'p' && !inMyVideos) {
        e.preventDefault();
        handlers.current.handleCreate();
      } else if (e.key === 'a' && canGenerate) {
        e.preventDefault();
        handlers.current.handleGenerate();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [inMyVideos, canGenerate]);

  const secondary =
    'h-9 px-3.5 border border-border rounded-lg bg-card text-foreground text-[14px] font-medium hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <BookmarkButton itemType="topic" refId={topicId} initialSaved={isFavorite} />

      <button type="button" onClick={handleCopyBrief} className={secondary}>
        Copier le brief
      </button>

      {inMyVideos ? (
        <Link
          href="/pipeline"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-[14px] font-medium text-foreground hover:bg-muted"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Déjà dans Mes vidéos · Ouvrir
        </Link>
      ) : (
        <button
          type="button"
          onClick={handleCreate}
          disabled={isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {isPending ? 'Création…' : 'Créer cette vidéo'}
        </button>
      )}

      {hasOpenVideo && !showPublishInput && (
        <button type="button" onClick={() => setShowPublishInput(true)} className={secondary}>
          Marquer publiée
        </button>
      )}
      {showPublishInput && (
        <>
          <Input
            type="url"
            inputMode="url"
            placeholder="Lien de ta vidéo publiée"
            aria-label="Lien de ta vidéo publiée sur YouTube"
            value={publishUrl}
            onChange={(e) => setPublishUrl(e.target.value)}
            className="w-56 h-9"
          />
          <button
            type="button"
            onClick={handleMarkPublished}
            disabled={isPending || !publishUrl.trim()}
            className="h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[14px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            Confirmer
          </button>
          <button
            type="button"
            onClick={() => { setShowPublishInput(false); setPublishUrl(''); }}
            className="h-9 px-2 text-[13px] text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Annuler
          </button>
        </>
      )}

      {canGenerate && (
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isPending}
          className={secondary}
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
