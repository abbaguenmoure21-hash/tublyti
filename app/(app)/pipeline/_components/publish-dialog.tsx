'use client';

import { useState } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { PipelineCard } from '../page';

export function PublishDialog({
  card,
  open,
  onOpenChange,
  onPublish,
  isPending,
  error = null,
}: {
  card: PipelineCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublish: (videoId: string) => void;
  isPending: boolean;
  error?: string | null;
}) {
  const [videoId, setVideoId] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!videoId.trim() || isPending) return;
    onPublish(videoId.trim());
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/20 supports-backdrop-filter:backdrop-blur-xs transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="elev-3 fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover transition duration-200 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <div className="p-5">
            <DialogPrimitive.Title className="text-[15px] font-semibold text-foreground">
              Publier « {card.angleTitle} »
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-[13px] text-muted-foreground">
              Colle le lien de ta vidéo YouTube. On vérifie qu’elle est bien en ligne.
            </DialogPrimitive.Description>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <Input
                type="text"
                placeholder="https://youtu.be/…"
                aria-label="Lien de la vidéo YouTube"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'publish-error' : undefined}
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
              {error && (
                <p id="publish-error" role="alert" className="text-[13px] text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={isPending}>
                  Annuler
                </Button>
                <Button type="submit" size="lg" disabled={!videoId.trim() || isPending}>
                  {isPending ? 'Vérification…' : 'Confirmer la publication'}
                </Button>
              </div>
            </form>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
