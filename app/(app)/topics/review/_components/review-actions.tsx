'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, X, GitMerge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reviewTopic } from '@/lib/actions/topics';

interface MergeTarget {
  id: string;
  label: string;
  niches: { name: string } | null;
}

interface ReviewActionsProps {
  topicId: string;
  mergeTargets: MergeTarget[];
}

export function ReviewActions({ topicId, mergeTargets }: ReviewActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [currentAction, setCurrentAction] = useState<'accept' | 'reject' | 'merge' | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');

  function handleAction(
    action: 'accept' | 'reject' | 'merge',
    mergeInto?: string,
  ) {
    setCurrentAction(action);
    startTransition(async () => {
      const result = await reviewTopic(topicId, action, mergeInto);
      if (result.error) {
        toast.error(result.error);
      } else {
        const labels = { accept: 'Sujet accepté.', reject: 'Sujet rejeté.', merge: 'Sujets fusionnés.' };
        toast.success(labels[action]);
      }
      setCurrentAction(null);
    });
  }

  const isActing = currentAction !== null || isPending;

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-4">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => handleAction('accept')}
          disabled={isActing}
          className="bg-success hover:bg-success/90 text-white"
        >
          <Check className="size-4" />
          {currentAction === 'accept' ? 'Validation...' : 'Accepter'}
        </Button>

        <Button
          variant="destructive"
          size="sm"
          onClick={() => handleAction('reject')}
          disabled={isActing}
        >
          <X className="size-3.5" />
          {currentAction === 'reject' ? 'Rejet...' : 'Rejeter'}
        </Button>
      </div>

      <div className="flex items-center gap-2 sm:ml-auto">
        <GitMerge className="size-4 text-muted-foreground hidden sm:block" />
        <select
          value={mergeTarget}
          onChange={(e) => setMergeTarget(e.target.value)}
          className="h-8 rounded-lg border border-border bg-background px-2 text-sm max-w-[250px] focus:outline-none focus:ring-2 focus:ring-ring/50"
        >
          <option value="">Fusionner avec...</option>
          {mergeTargets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
              {t.niches ? ` (${t.niches.name})` : ''}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          onClick={() => {
            if (!mergeTarget) {
              toast.warning('Sélectionnez un sujet cible pour la fusion.');
              return;
            }
            handleAction('merge', mergeTarget);
          }}
          disabled={isActing || !mergeTarget}
        >
          <GitMerge className="size-4" />
          {currentAction === 'merge' ? 'Fusion...' : 'Fusionner'}
        </Button>
      </div>
    </div>
  );
}
