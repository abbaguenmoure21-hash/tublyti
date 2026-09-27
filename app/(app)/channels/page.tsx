'use client';

import { useEffect, useState, useCallback } from 'react';
import { Tv, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

interface Channel {
  id: string;
  title: string;
  subscriber_count: number | null;
  last_checked_at: string | null;
  niche_id: string;
  niches: { name: string } | null;
}

interface Niche {
  id: string;
  name: string;
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [nicheId, setNicheId] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/channels');
      if (!res.ok) throw new Error('Impossible de charger les chaînes');
      const data = await res.json();
      setChannels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    // Fetch niches for the select
    fetch('/api/niches')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setNiches(data);
      })
      .catch(() => {});
  }, [fetchChannels]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url || !nicheId) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, niche_id: nicheId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUrl('');
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'ajout");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (deleting) return;
    setDeleting(id);
    try {
      const res = await fetch('/api/channels', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      await fetchChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la suppression');
    } finally {
      setDeleting(null);
    }
  }

  function formatDate(d: string | null) {
    if (!d) return 'Jamais';
    return new Date(d).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Chaines surveillees</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gerez les chaines YouTube suivies par TubLyTI pour detecter les opportunites.
        </p>
      </div>

      {/* Add channel form */}
      <Card>
        <CardHeader>
          <CardTitle>Ajouter une chaine</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <Input
              type="text"
              placeholder="URL ou ID de la chaine"
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
            <Button type="submit" disabled={adding || !url || !nicheId}>
              <Plus className="size-4" />
              {adding ? 'Ajout...' : 'Ajouter'}
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

      {/* Channel list */}
      {loading ? (
        <Card>
          <CardContent className="space-y-4 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-28 ml-auto" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : error && channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="size-10 text-destructive mb-3" />
            <p className="text-sm font-medium text-destructive">
              Impossible de charger les chaines
            </p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
          </CardContent>
        </Card>
      ) : channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Tv className="size-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              Aucune chaine suivie
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Ajoutez-en une ci-dessus ou lancez{' '}
              <code className="bg-muted rounded px-1.5 py-0.5 text-foreground">pnpm seed</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {channels.length} chaine{channels.length > 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-left">
                    <th className="px-3 py-2.5 font-medium rounded-tl-md">Chaine</th>
                    <th className="px-3 py-2.5 font-medium">Niche</th>
                    <th className="px-3 py-2.5 font-medium">Abonnes</th>
                    <th className="px-3 py-2.5 font-medium">Derniere verification</th>
                    <th className="px-3 py-2.5 font-medium rounded-tr-md w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((ch) => (
                    <tr
                      key={ch.id}
                      className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium">{ch.title ?? ch.id}</td>
                      <td className="px-3 py-2.5">
                        {ch.niches?.name ? (
                          <Badge variant="secondary">{ch.niches.name}</Badge>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {ch.subscriber_count
                          ? ch.subscriber_count.toLocaleString('fr-FR')
                          : '--'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {formatDate(ch.last_checked_at)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={deleting === ch.id}
                          onClick={() => {
                            if (confirm(`Supprimer \u00AB ${ch.title ?? ch.id} \u00BB ?`)) {
                              handleDelete(ch.id);
                            }
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
