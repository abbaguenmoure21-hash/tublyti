'use client';

import { useState, useTransition } from 'react';
import { useTheme } from 'next-themes';
import { SunMedium, Moon, Monitor, Plus, Trash2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { createCollection, deleteCollection } from '@/lib/actions/collections';
import { sendDigestNow } from '@/lib/actions/digest';

interface CollectionData {
  id: string;
  name: string;
  isDefault: boolean;
}

export function AppearanceTab({ collections }: { collections: CollectionData[] }) {
  const { theme, setTheme } = useTheme();
  const [newName, setNewName] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleCreateCollection() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const result = await createCollection(newName.trim());
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Collection créée.');
        setNewName('');
      }
    });
  }

  function handleDeleteCollection(id: string) {
    startTransition(async () => {
      const result = await deleteCollection(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Collection supprimée.');
      }
    });
  }

  function handleSendDigest() {
    startTransition(async () => {
      const result = await sendDigestNow();
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Digest envoyé.');
      }
    });
  }

  const themes = [
    { value: 'light', label: 'Clair', icon: SunMedium },
    { value: 'dark', label: 'Sombre', icon: Moon },
    { value: 'system', label: 'Système', icon: Monitor },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Theme */}
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5">
        <h2 className="text-[15px] font-semibold mb-3">Thème</h2>
        <div className="flex gap-2">
          {themes.map((t) => {
            const Icon = t.icon;
            const active = theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTheme(t.value)}
                className={`flex items-center gap-2 h-10 px-4 rounded-lg text-[13px] font-medium transition-colors cursor-pointer border ${
                  active
                    ? 'border-primary bg-primary-soft text-primary-ink'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Collections */}
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)]">
        <div className="px-5 py-3.5 border-b border-border">
          <h2 className="text-[15px] font-semibold">Collections</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Organise tes favoris en collections nommées.
          </p>
        </div>

        <div className="divide-y divide-border">
          {collections.map((col) => (
            <div key={col.id} className="px-5 py-2.5 flex items-center gap-3">
              <span className="flex-1 text-[13px]">
                {col.name}
                {col.isDefault && (
                  <span className="ml-2 text-[11px] text-muted-foreground">(par défaut)</span>
                )}
              </span>
              {!col.isDefault && (
                <button
                  type="button"
                  onClick={() => handleDeleteCollection(col.id)}
                  disabled={isPending}
                  className="w-7 h-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Add collection */}
        <div className="px-5 py-3 border-t border-border flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
            placeholder="Nouvelle collection…"
            className="flex-1 h-8 px-2.5 border border-border rounded-md bg-card text-[13px] text-foreground"
          />
          <button
            type="button"
            onClick={handleCreateCollection}
            disabled={isPending || !newName.trim()}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Ajouter
          </button>
        </div>
      </section>

      {/* Digest */}
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5">
        <h2 className="text-[15px] font-semibold mb-1">Digest hebdomadaire</h2>
        <p className="text-[12px] text-muted-foreground mb-3">
          Chaque dimanche a 06:00 UTC, un email recapitule les meilleurs sujets, les nouvelles phases 2 et les resultats de tes videos publiees.
        </p>
        <button
          type="button"
          onClick={handleSendDigest}
          disabled={isPending}
          className="flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
          {isPending ? 'Envoi…' : 'M\'envoyer le digest maintenant'}
        </button>
      </section>
    </div>
  );
}
