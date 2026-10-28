'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { deleteChannel } from '@/lib/actions/channels';

export function DeleteChannelButton({
  channelId,
  channelTitle,
}: {
  channelId: string;
  channelTitle: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(`Supprimer \u00AB ${channelTitle} \u00BB ?`)) return;
    startTransition(async () => {
      const result = await deleteChannel(channelId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success('Chaîne supprimée.');
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground hover:text-destructive"
      disabled={isPending}
      onClick={handleDelete}
      aria-label={`Supprimer la chaîne ${channelTitle}`}
    >
      <Trash2 className="size-3.5" aria-hidden="true" />
    </Button>
  );
}
