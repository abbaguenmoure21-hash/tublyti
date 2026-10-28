'use client';

import { useState } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Input } from '@/components/ui/input';
import type { PipelineCard } from '../page';

export function PublishDialog({
  card,
  open,
  onOpenChange,
  onPublish,
  isPending,
}: {
  card: PipelineCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublish: (videoId: string) => void;
  isPending: boolean;
}) {
  const [videoId, setVideoId] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!videoId.trim()) return;
    onPublish(videoId.trim());
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 supports-backdrop-filter:backdrop-blur-xs transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,calc(100vw-32px))] bg-popover border border-border rounded-xl shadow-[0_8px_24px_rgba(20,24,34,0.10)] transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95">
          <div className="p-5">
            <DialogPrimitive.Title className="text-[15px] font-semibold text-foreground">
              Publier « {card.angleTitle} »
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[13px] text-muted-foreground mt-1">
              Entre l'identifiant ou l'URL de la vidéo YouTube publiée.
              L'API vérifiera que la vidéo existe (1 unité de quota).
            </DialogPrimitive.Description>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <Input
                type="text"
                placeholder="dQw4w9WgXcQ ou URL complète"
                aria-label="Lien de la vidéo YouTube"
                value={videoId}
                onChange={(e) => {
                  // Extract video ID from URL if pasted
                  let val = e.target.value;
                  const urlMatch = val.match(
                    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/,
                  );
                  if (urlMatch) val = urlMatch[1];
                  setVideoId(val);
                }}
                autoFocus
                className="w-full"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="h-9 px-3.5 rounded-lg border border-border bg-card text-foreground text-[13px] font-medium hover:bg-muted transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!videoId.trim() || isPending}
                  className="h-9 px-3.5 rounded-lg bg-phase-2 text-white text-[13px] font-medium hover:bg-phase-2/90 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isPending ? 'Vérification…' : 'Confirmer la publication'}
                </button>
              </div>
            </form>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
