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
  const [impactError, setImpactError] = useState(false);

  function ask() {
    setVideos(null);
    setImpactError(false);
    setOpen(true);
    startTransition(async () => {
      const res = await getChannelImpact(channelId);
      if ('videos' in res) setVideos(res.videos);
      else setImpactError(true);
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

  const blocked = videos !== null && videos > 0;

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
        title={blocked ? `« ${channelTitle} » ne peut pas être supprimée` : `Supprimer « ${channelTitle} » ?`}
        description={
          blocked ? (
            <div className="flex flex-col gap-2">
              <p>
                Cette chaîne a {videos!.toLocaleString('fr-FR')} vidéo{videos! > 1 ? 's' : ''} dans le catalogue commun : elle ne peut pas être supprimée sans casser les sujets qui s’appuient dessus.
              </p>
              <p>Seule une chaîne sans aucune vidéo collectée peut être retirée.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p>La chaîne sera retirée du catalogue de tous les clients et ne sera plus collectée.</p>
              <p>
                {impactError
                  ? 'Impossible de vérifier ses vidéos pour le moment. Ferme et réessaie.'
                  : videos === null
                    ? 'Vérification de ses vidéos…'
                    : 'Elle n’a encore aucune vidéo dans le catalogue.'}
              </p>
              <p className="font-medium text-foreground">Action définitive.</p>
            </div>
          )
        }
        confirmLabel="Supprimer la chaîne"
        onConfirm={handleDelete}
        destructive
        pending={isPending}
        blocked={blocked}
        confirmDisabled={videos === null || impactError}
      />
    </>
  );
}
