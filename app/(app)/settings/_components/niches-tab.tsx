'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Pencil, Check, X } from 'lucide-react';
import { updateNiche } from '@/lib/actions/settings';

interface NicheData {
  id: string;
  name: string;
  category: string;
  rpmCoefficient: number;
  ownerChannel: string;
  status: string;
  rpmLow: number | null;
  rpmHigh: number | null;
  rpmSource: string | null;
}

export function NichesTab({ niches }: { niches: NicheData[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<NicheData>>({});
  const [isPending, startTransition] = useTransition();

  function startEdit(niche: NicheData) {
    setEditingId(niche.id);
    setEditForm({
      name: niche.name,
      category: niche.category,
      rpmCoefficient: niche.rpmCoefficient,
      ownerChannel: niche.ownerChannel,
      rpmLow: niche.rpmLow,
      rpmHigh: niche.rpmHigh,
      rpmSource: niche.rpmSource,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  function handleSave(nicheId: string) {
    startTransition(async () => {
      const result = await updateNiche(nicheId, {
        name: editForm.name,
        category: editForm.category,
        rpm_coefficient: editForm.rpmCoefficient,
        owner_channel: editForm.ownerChannel,
        rpm_low: editForm.rpmLow ?? undefined,
        rpm_high: editForm.rpmHigh ?? undefined,
        rpm_source: editForm.rpmSource ?? undefined,
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Niche mise à jour.');
        setEditingId(null);
      }
    });
  }

  return (
    <div className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)]">
      <div className="px-5 py-3.5 border-b border-border">
        <h2 className="text-[15px] font-semibold">Niches</h2>
      </div>

      {niches.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">
          Aucune niche configurée.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {niches.map((niche) => {
            const isEditing = editingId === niche.id;

            return (
              <div key={niche.id} className="px-5 py-3 flex items-center gap-3">
                {isEditing ? (
                  <>
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input
                          type="text"
                          value={editForm.name ?? ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                          placeholder="Nom"
                          aria-label="Nom"
                          className="h-8 px-2.5 border border-border rounded-md text-[13px] bg-card text-foreground"
                        />
                        <input
                          type="text"
                          value={editForm.category ?? ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                          placeholder="Catégorie"
                          aria-label="Catégorie"
                          className="h-8 px-2.5 border border-border rounded-md text-[13px] bg-card text-foreground"
                        />
                        <input
                          type="number"
                          step="0.1"
                          value={editForm.rpmCoefficient ?? 1}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, rpmCoefficient: Number(e.target.value) }))
                          }
                          placeholder="Coeff. RPM"
                          aria-label="Coeff. RPM"
                          className="h-8 px-2.5 border border-border rounded-md text-[13px] bg-card text-foreground"
                        />
                        <input
                          type="text"
                          value={editForm.ownerChannel ?? ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, ownerChannel: e.target.value }))}
                          placeholder="Chaîne liée"
                          aria-label="Chaîne liée"
                          className="h-8 px-2.5 border border-border rounded-md text-[13px] bg-card text-foreground"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="number"
                          step="0.5"
                          value={editForm.rpmLow ?? ''}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, rpmLow: e.target.value ? Number(e.target.value) : null }))
                          }
                          placeholder="RPM bas ($)"
                          aria-label="RPM bas ($)"
                          className="h-8 px-2.5 border border-border rounded-md text-[13px] bg-card text-foreground"
                        />
                        <input
                          type="number"
                          step="0.5"
                          value={editForm.rpmHigh ?? ''}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, rpmHigh: e.target.value ? Number(e.target.value) : null }))
                          }
                          placeholder="RPM haut ($)"
                          aria-label="RPM haut ($)"
                          className="h-8 px-2.5 border border-border rounded-md text-[13px] bg-card text-foreground"
                        />
                        <input
                          type="text"
                          value={editForm.rpmSource ?? ''}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, rpmSource: e.target.value || null }))
                          }
                          placeholder="Source RPM (ex. YouTube Studio)"
                          aria-label="Source RPM (ex. YouTube Studio)"
                          className="h-8 px-2.5 border border-border rounded-md text-[13px] bg-card text-foreground"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSave(niche.id)}
                      disabled={isPending}
                      aria-label="Enregistrer la niche"
                      className="relative after:absolute after:-inset-2 md:after:hidden w-7 h-7 rounded-md text-phase-2 hover:bg-muted flex items-center justify-center cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      aria-label="Annuler la modification"
                      className="relative after:absolute after:-inset-2 md:after:hidden w-7 h-7 rounded-md text-muted-foreground hover:bg-muted flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 flex flex-col gap-0.5 text-[13px]">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <span className="font-medium">{niche.name}</span>
                        <span className="text-muted-foreground">{niche.category}</span>
                        <span className="tabular-nums">
                          {niche.rpmLow && niche.rpmHigh
                            ? `${niche.rpmLow}–${niche.rpmHigh} $`
                            : `RPM ×${niche.rpmCoefficient}`}
                        </span>
                        <span className="text-muted-foreground truncate">
                          {niche.ownerChannel || '—'}
                        </span>
                      </div>
                      {niche.rpmSource && (
                        <span className="text-[11px] text-muted-foreground ml-[50%]">
                          Source : {niche.rpmSource}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(niche)}
                      aria-label={`Modifier ${niche.name}`}
                      className="relative after:absolute after:-inset-2 md:after:hidden w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
