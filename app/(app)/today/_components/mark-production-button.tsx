'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { markTopicProduction } from '@/lib/actions/topics';

export function MarkProductionButton({ topicId }: { topicId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await markTopicProduction(topicId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success('Sujet marqué en production.');
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="h-[30px] px-3 rounded-md bg-primary-soft text-primary-ink text-[13px] font-medium hover:bg-primary-soft/80 transition-colors disabled:opacity-50 cursor-pointer"
    >
      {isPending ? 'Marquage…' : 'En production'}
    </button>
  );
}
