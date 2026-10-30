'use client';

import { useState, useTransition } from 'react';
import { Bookmark } from 'lucide-react';
import { toast } from 'sonner';
import { toggleFavorite } from '@/lib/actions/collections';

export function BookmarkButton({
  itemType,
  refId,
  initialSaved = false,
  size = 'default',
}: {
  itemType: string;
  refId: string;
  initialSaved?: boolean;
  size?: 'default' | 'sm';
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await toggleFavorite(itemType, refId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSaved(result.added ?? false);
      toast.success(result.added ? 'Ajouté aux favoris.' : 'Retiré des favoris.');
    });
  }

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const btnSize = size === 'sm' ? 'relative w-7 h-7 after:absolute after:-inset-2 md:after:hidden' : 'relative w-9 h-9 after:absolute after:-inset-1 md:after:hidden';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={saved ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className={`${btnSize} border border-border rounded-lg bg-card flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 ${
        saved
          ? 'text-primary hover:bg-primary-soft'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Bookmark
        className={iconSize}
        fill={saved ? 'currentColor' : 'none'}
      />
    </button>
  );
}
