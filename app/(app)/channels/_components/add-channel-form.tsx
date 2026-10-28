'use client';

import { useState, useTransition } from 'react';
import { Plus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addChannel } from '@/lib/actions/channels';

interface Niche {
  id: string;
  name: string;
}

export function AddChannelForm({ niches }: { niches: Niche[] }) {
  const [url, setUrl] = useState('');
  const [nicheId, setNicheId] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url || !nicheId) return;
    setError(null);
    startTransition(async () => {
      const result = await addChannel(url, nicheId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setUrl('');
      toast.success('Chaîne ajoutée.');
    });
  }

  return (
    <div className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-[0_4px_20px_rgb(0,0,0,0.03)] rounded-[24px] p-6 transition-all">
      <div className="mb-4">
        <h2 className="text-[18px] font-bold text-foreground">Ajouter une chaîne</h2>
      </div>
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
        <Input
          type="text"
          placeholder="URL ou ID de la chaîne"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 h-[44px] rounded-full px-5 text-[14px] bg-white dark:bg-[#1C1C1E] border-black/10 dark:border-white/10 shadow-sm focus-visible:ring-primary/30"
        />
        <select
          value={nicheId}
          onChange={(e) => setNicheId(e.target.value)}
          className="h-[44px] rounded-full border border-black/10 dark:border-white/10 bg-white dark:bg-[#1C1C1E] px-4 text-[14px] font-medium min-w-[160px] shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer"
        >
          <option value="">Niche...</option>
          {niches.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          disabled={isPending || !url || !nicheId}
          className="haptic-btn h-[44px] px-6 rounded-full font-bold text-[14px] shadow-[0_4px_12px_rgba(10,132,255,0.25)] transition-all bg-gradient-to-b from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90 text-primary-foreground border border-primary/20"
        >
          <Plus className="size-5 mr-1" />
          {isPending ? 'Ajout...' : 'Ajouter'}
        </Button>
      </form>
      {error && (
        <p className="text-destructive mt-3 text-[13px] font-medium flex items-center gap-1.5 bg-destructive/10 text-destructive px-4 py-2 rounded-xl w-fit">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
