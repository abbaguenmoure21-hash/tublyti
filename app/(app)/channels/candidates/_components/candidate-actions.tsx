'use client';

import { useState, useTransition } from 'react';
import { followCandidate, ignoreCandidate } from '@/lib/actions/candidates';
import { Check, X } from 'lucide-react';

interface Niche {
  id: string;
  name: string;
}

export function CandidateActions({
  candidateId,
  niches,
}: {
  candidateId: string;
  niches: Niche[];
}) {
  const [selectedNiche, setSelectedNiche] = useState(niches[0]?.id ?? '');
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<'followed' | 'ignored' | null>(null);

  if (done === 'followed') {
    return (
      <span className="text-[13px] text-success font-medium flex items-center gap-1">
        <Check className="w-3.5 h-3.5" /> Suivie
      </span>
    );
  }
  if (done === 'ignored') {
    return (
      <span className="text-[13px] text-muted-foreground font-medium flex items-center gap-1">
        <X className="w-3.5 h-3.5" /> Ignorée
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={selectedNiche}
        onChange={(e) => setSelectedNiche(e.target.value)}
        className="h-[30px] px-2 rounded-md border border-border bg-card text-[13px] text-foreground"
        disabled={isPending}
      >
        {niches.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          startTransition(async () => {
            const result = await followCandidate(candidateId, selectedNiche);
            if (result.ok) setDone('followed');
          });
        }}
        disabled={isPending || !selectedNiche}
        className="h-[30px] px-3 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
      >
        Suivre
      </button>
      <button
        onClick={() => {
          startTransition(async () => {
            const result = await ignoreCandidate(candidateId);
            if (result.ok) setDone('ignored');
          });
        }}
        disabled={isPending}
        className="h-[30px] px-3 rounded-md border border-border text-[13px] font-medium hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer"
      >
        Ignorer
      </button>
    </div>
  );
}
