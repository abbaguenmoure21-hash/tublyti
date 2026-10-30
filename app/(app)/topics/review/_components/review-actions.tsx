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
          className="haptic-btn h-11 md:h-[32px] px-4 rounded-full bg-success/10 hover:bg-success/20 text-success border border-success/20 shadow-sm font-bold text-[13px] transition-all"
        >
          <Check className="size-4" />
          {currentAction === 'accept' ? 'Validation...' : 'Accepter'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => handleAction('reject')}
          disabled={isActing}
          className="haptic-btn h-11 md:h-[32px] px-4 rounded-full bg-destructive/5 hover:bg-destructive/10 text-destructive border border-destructive/20 shadow-sm font-bold text-[13px] transition-all"
        >
          <X className="size-4" />
          {currentAction === 'reject' ? 'Rejet...' : 'Rejeter'}
        </Button>
      </div>

      <div className="flex items-center gap-2 sm:ml-auto">
        <GitMerge className="size-4 text-muted-foreground hidden sm:block" />
        <select
          value={mergeTarget}
          onChange={(e) => setMergeTarget(e.target.value)}
          aria-label="Fusionner avec un autre sujet"
          className="h-11 md:h-[32px] rounded-full border border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#1C1C1E] px-3 text-[13px] font-medium max-w-[250px] shadow-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all cursor-pointer"
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
          size="sm"
          onClick={() => {
            if (!mergeTarget) {
              toast.warning('Sélectionnez un sujet cible pour la fusion.');
              return;
            }
            handleAction('merge', mergeTarget);
          }}
          disabled={isActing || !mergeTarget}
          className="haptic-btn h-11 md:h-[32px] px-4 rounded-full font-bold text-[13px] shadow-sm transition-all bg-white dark:bg-white/10 hover:bg-black/5 dark:hover:bg-white/20 border-black/10 dark:border-white/10 text-foreground"
        >
          <GitMerge className="size-4" />
          {currentAction === 'merge' ? 'Fusion...' : 'Fusionner'}
        </Button>
      </div>
    </div>
  );
}
