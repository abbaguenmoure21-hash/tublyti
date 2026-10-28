'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { deleteChannel, getChannelImpact } from '@/lib/actions/channels';

export function DeleteChannelButton({
  channelId,
  channelTitle,
}: {
  channelId: string;
  channelTitle: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [videos, setVideos] = useState<number | null>(null);

  function ask() {
    setVideos(null);
    setOpen(true);
    startTransition(async () => {
      const res = await getChannelImpact(channelId);
      if ('videos' in res) setVideos(res.videos);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteChannel(channelId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success(`« ${channelTitle} » retirée du catalogue`);
    });
  }

  const impact =
    videos === null
      ? 'Calcul de l’impact…'
      : videos > 0
        ? `Elle a ${videos.toLocaleString('fr-FR')} vidéo${videos > 1 ? 's' : ''} dans le catalogue commun : les sujets qui s’appuient dessus perdront ces sources pour tous les clients.`
        : 'Elle n’a encore aucune vidéo dans le catalogue.';

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-10 text-muted-foreground hover:text-destructive md:size-8"
        disabled={isPending}
        onClick={ask}
        aria-label={`Supprimer ${channelTitle}`}
        title={`Supprimer ${channelTitle}`}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Supprimer « ${channelTitle} » ?`}
        description={
          <div className="flex flex-col gap-2">
            <p>La chaîne sera retirée du catalogue de tous les clients et ne sera plus collectée.</p>
            <p>{impact}</p>
            <p className="font-medium text-foreground">Action définitive.</p>
          </div>
        }
        confirmLabel="Supprimer la chaîne"
        onConfirm={handleDelete}
        destructive
        pending={isPending}
      />
    </>
  );
}
