'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { addMyChannel, removeMyChannel } from '@/lib/actions/compte';

interface Channel { id: string; title: string; nicheId: string; nicheName: string; youtube: string | null }
interface Niche { id: string; name: string; color: string }

const field = 'h-10 rounded-[10px] border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

export function MyChannels({ channels, catalogue }: { channels: Channel[]; catalogue: Niche[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(channels.length === 0);
  const [title, setTitle] = useState('');
  const [nicheId, setNicheId] = useState('');
  const [youtube, setYoutube] = useState('');
  const taken = new Set(channels.map((c) => c.nicheId));
  const available = catalogue.filter((n) => !taken.has(n.id));
  const colorOf = new Map(catalogue.map((n) => [n.id, n.color]));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await addMyChannel({ title, nicheId, youtube: youtube || undefined });
      if ('error' in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success('Chaîne ajoutée', { description: 'Ses sujets apparaissent dans « Sujets ».' });
      setTitle('');
      setNicheId('');
      setYoutube('');
      setAdding(false);
      router.refresh();
    });
  }

  function remove(c: Channel) {
    startTransition(async () => {
      const res = await removeMyChannel(c.id);
      if ('error' in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast(`${c.title} retirée`, { description: 'Tes vidéos déjà créées restent dans « Mes vidéos ».' });
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {channels.length > 0 && (
        <ul>
          {channels.map((c) => (
            <li key={c.id} className="flex items-center gap-3 border-b border-muted px-4 py-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf.get(c.nicheId) ?? 'var(--muted-foreground)' }} aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-medium">{c.title}</span>
                <span className="truncate text-[13px] text-muted-foreground">{c.nicheName}{c.youtube ? ` · ${c.youtube}` : ''}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(c)}
                disabled={pending}
                aria-label={`Retirer ${c.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Nom de la chaîne
            <input autoFocus required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Mon Budget Malin" className={field} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Thématique
            <select required value={nicheId} onChange={(e) => setNicheId(e.target.value)} className={field}>
              <option value="" disabled>Choisis la thématique de ta chaîne</option>
              {available.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
            <span className="text-xs font-normal text-muted-foreground">Ta thématique n’est pas dans la liste ? Écris-nous, nous l’ajoutons.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Adresse YouTube <span className="font-normal text-muted-foreground">(facultatif)</span>
            <input value={youtube} onChange={(e) => setYoutube(e.target.value)} placeholder="youtube.com/@machaine" className={field} />
            <span className="text-xs font-normal text-muted-foreground">Sert à mesurer les résultats de tes vidéos publiées.</span>
          </label>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={pending} className="inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {pending ? 'Ajout…' : 'Ajouter la chaîne'}
            </button>
            {channels.length > 0 && (
              <button type="button" onClick={() => setAdding(false)} className="inline-flex h-10 items-center rounded-[10px] px-4 text-sm font-medium text-muted-foreground hover:bg-muted">
                Annuler
              </button>
            )}
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!available.length}
          className="flex h-12 w-full items-center gap-2 px-4 text-sm font-medium text-primary hover:bg-muted disabled:text-muted-foreground"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {available.length ? 'Ajouter une chaîne' : 'Toutes les thématiques ont déjà une chaîne'}
        </button>
      )}
    </div>
  );
}
