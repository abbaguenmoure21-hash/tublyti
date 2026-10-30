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
  defaultNiche,
}: {
  candidateId: string;
  niches: Niche[];
  defaultNiche?: string;
}) {
  const [selectedNiche, setSelectedNiche] = useState(defaultNiche ?? niches[0]?.id ?? '');
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
        aria-label="Niche de la chaîne"
        className="h-11 md:h-[32px] rounded-full border border-black/10 dark:border-white/10 bg-white/50 dark:bg-[#1C1C1E] px-3 text-[12px] font-bold max-w-[120px] shadow-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all cursor-pointer truncate"
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
        className="haptic-btn h-11 md:h-[32px] px-3 rounded-full bg-success/10 text-success border border-success/20 text-[12px] font-bold hover:bg-success/20 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
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
        className="haptic-btn h-11 md:h-[32px] px-3 rounded-full border border-black/10 dark:border-white/10 bg-white dark:bg-white/10 text-foreground text-[12px] font-bold hover:bg-black/5 dark:hover:bg-white/20 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
      >
        Ignorer
      </button>
    </div>
  );
}
