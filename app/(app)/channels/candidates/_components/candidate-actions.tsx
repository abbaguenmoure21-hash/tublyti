'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { followCandidate, ignoreCandidate, restoreCandidate } from '@/lib/actions/candidates';

interface Niche {
  id: string;
  name: string;
}

export function CandidateActions({
  candidateId,
  candidateTitle,
  niches,
  defaultNiche,
}: {
  candidateId: string;
  candidateTitle: string;
  niches: Niche[];
  defaultNiche?: string;
}) {
  const [selectedNiche, setSelectedNiche] = useState(defaultNiche ?? niches[0]?.id ?? '');
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState<'follow' | 'ignore' | null>(null);
  const [done, setDone] = useState<'followed' | 'ignored' | null>(null);

  function follow() {
    setRunning('follow');
    startTransition(async () => {
      const result = await followCandidate(candidateId, selectedNiche);
      if (result.ok) {
        setDone('followed');
        toast.success(`« ${candidateTitle} » ajoutée au catalogue`);
      } else {
        toast.error('Impossible de suivre cette chaîne. Réessaie dans un instant.');
      }
      setRunning(null);
    });
  }

  function ignore() {
    setRunning('ignore');
    startTransition(async () => {
      const result = await ignoreCandidate(candidateId);
      if (result.ok) {
        setDone('ignored');
        toast(`« ${candidateTitle} » ignorée`, {
          action: {
            label: 'Annuler',
            onClick: () => {
              startTransition(async () => {
                const undo = await restoreCandidate(candidateId);
                if (undo.ok) setDone(null);
                else toast.error(undo.error ?? 'Impossible d’annuler.');
              });
            },
          },
        });
      } else {
        toast.error('Impossible d’ignorer cette chaîne. Réessaie dans un instant.');
      }
      setRunning(null);
    });
  }

  if (done === 'followed') {
    return (
      <span className="flex items-center gap-1 text-[13px] font-medium text-phase-2-ink">
        <Check className="size-3.5" aria-hidden="true" /> Suivie
      </span>
    );
  }
  if (done === 'ignored') {
    return (
      <span className="flex items-center gap-1 text-[13px] font-medium text-muted-foreground">
        <X className="size-3.5" aria-hidden="true" /> Ignorée
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedNiche}
        onChange={(e) => setSelectedNiche(e.target.value)}
        aria-label={`Niche pour ${candidateTitle}`}
        className="well h-8 max-w-[140px] cursor-pointer truncate rounded-[10px] bg-muted px-2 text-[13px] text-foreground"
        disabled={isPending}
      >
        {niches.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
      <Button size="sm" onClick={follow} disabled={isPending || !selectedNiche}>
        {running === 'follow' ? 'Ajout…' : 'Suivre'}
      </Button>
      <Button size="sm" variant="outline" onClick={ignore} disabled={isPending}>
        {running === 'ignore' ? 'Un instant…' : 'Ignorer'}
      </Button>
    </div>
  );
}
