'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { correctLabel } from '@/lib/actions/frustrations';

const ALL_LABELS = [
  'no_one_explains',
  'wish_video_on',
  'stopped_too_early',
  'searched_long',
  'none',
] as const;

const LABEL_NAMES: Record<string, string> = {
  no_one_explains: 'Personne ne traite',
  wish_video_on: 'Souhait de vidéo',
  stopped_too_early: 'Trop court',
  searched_long: 'Longue recherche',
  none: 'Aucun',
};

export function LabelCorrector({
  commentId,
  currentLabel,
}: {
  commentId: string;
  currentLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleCorrect(newLabel: string) {
    startTransition(async () => {
      const result = await correctLabel(commentId, newLabel);
      if (result.error) {
        toast.error('Erreur lors de la correction du label.');
        return;
      }
      setEditing(false);
      toast.success('Label corrigé.');
    });
  }

  if (editing) {
    return (
      <div className="flex flex-wrap gap-1">
        {ALL_LABELS.map((l) => (
          <Button
            key={l}
            variant="outline"
            size="xs"
            disabled={isPending}
            onClick={() => handleCorrect(l)}
            className={l === currentLabel ? 'ring-2 ring-primary' : ''}
          >
            {LABEL_NAMES[l]}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="xs"
          disabled={isPending}
          onClick={() => setEditing(false)}
        >
          annuler
        </Button>
      </div>
    );
  }

  return (
    <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
      corriger
    </Button>
  );
}
