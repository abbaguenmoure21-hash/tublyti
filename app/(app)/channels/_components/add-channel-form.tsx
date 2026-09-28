'use client';

import { useState, useTransition } from 'react';
import { Plus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card>
      <CardHeader>
        <CardTitle>Ajouter une chaîne</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
          <Input
            type="text"
            placeholder="URL ou ID de la chaîne"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="flex-1"
          />
          <select
            value={nicheId}
            onChange={(e) => setNicheId(e.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="">Niche...</option>
            {niches.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={isPending || !url || !nicheId}>
            <Plus className="size-4" />
            {isPending ? 'Ajout...' : 'Ajouter'}
          </Button>
        </form>
        {error && (
          <p className="text-destructive mt-3 text-sm flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
