'use client';

import { useEffect, useState, useCallback } from 'react';

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
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold">Chaînes surveillées</h1>

      {/* Add form */}
      <form onSubmit={handleAdd} className="mt-4 flex gap-2">
        <input
          type="text"
          placeholder="URL ou ID de la chaîne"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm"
        />
        <select
          value={nicheId}
          onChange={(e) => setNicheId(e.target.value)}
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        >
          <option value="">Niche…</option>
          {niches.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={adding || !url || !nicheId}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {adding ? 'Ajout…' : 'Ajouter'}
        </button>
      </form>

      {error && <p className="text-destructive mt-2 text-sm">{error}</p>}

      {/* List */}
      {loading ? (
        <p className="text-muted-foreground mt-6">Chargement…</p>
      ) : channels.length === 0 ? (
        <p className="text-muted-foreground mt-6">
          Aucune chaîne suivie. Ajoutez-en une ci-dessus ou lancez{' '}
          <code className="bg-muted rounded px-1">pnpm seed</code>.
        </p>
      ) : (
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="pb-2 font-medium">Chaîne</th>
              <th className="pb-2 font-medium">Niche</th>
              <th className="pb-2 font-medium">Abonnés</th>
              <th className="pb-2 font-medium">Dernière vérification</th>
              <th className="pb-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch.id} className="border-b">
                <td className="py-2 font-medium">{ch.title ?? ch.id}</td>
                <td className="py-2">{ch.niches?.name ?? '—'}</td>
                <td className="py-2">
                  {ch.subscriber_count ? ch.subscriber_count.toLocaleString('fr-FR') : '—'}
                </td>
                <td className="py-2">{formatDate(ch.last_checked_at)}</td>
                <td className="py-2">
                  <button
                    onClick={() => {
                      if (confirm(`Supprimer « ${ch.title ?? ch.id} » ?`)) {
                        handleDelete(ch.id);
                      }
                    }}
                    disabled={deleting === ch.id}
                    className="text-destructive text-xs hover:underline disabled:opacity-50"
                  >
                    {deleting === ch.id ? '…' : 'Supprimer'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
