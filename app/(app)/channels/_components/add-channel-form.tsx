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
      toast.success('Chaîne ajoutée au catalogue');
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3">
        <h2 className="text-base font-semibold">Ajouter une chaîne</h2>
      </div>
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
        <Input
          type="text"
          placeholder="Adresse de la chaîne YouTube"
          aria-label="Adresse de la chaîne YouTube"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-10 flex-1"
        />
        <select
          value={nicheId}
          onChange={(e) => setNicheId(e.target.value)}
          aria-label="Niche"
          className="well h-10 min-w-40 cursor-pointer rounded-[10px] bg-muted px-3 text-sm text-foreground"
        >
          <option value="">Niche…</option>
          {niches.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          disabled={isPending || !url || !nicheId}
          className="h-10"
        >
          <Plus aria-hidden="true" />
          {isPending ? 'Ajout…' : 'Ajouter'}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 flex w-fit items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
