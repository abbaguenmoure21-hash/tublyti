'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { saveScoringSettings } from '@/lib/actions/settings';
import type { ScoringSettings } from '@/lib/scoring/scoring-config';

interface TopTenItem {
  id: string;
  label: string;
  nicheName: string;
  phase: number;
  mgi: number;
}

export function ScoringTab({
  scoring,
  defaultScoring,
  topTen,
}: {
  scoring: ScoringSettings;
  defaultScoring: ScoringSettings;
  topTen: TopTenItem[];
}) {
  const [thresholds, setThresholds] = useState(scoring.thresholds);
  const [isPending, startTransition] = useTransition();

  const isModified =
    JSON.stringify(thresholds) !== JSON.stringify(scoring.thresholds);

  function handleSave() {
    startTransition(async () => {
      const result = await saveScoringSettings({ thresholds });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Paramètres de scoring enregistrés.');
      }
    });
  }

  function handleReset() {
    setThresholds(defaultScoring.thresholds);
  }

  return (
    <div className="space-y-6">
      {/* Demand info */}
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5 space-y-2">
        <h2 className="text-[15px] font-semibold">Demande (D)</h2>
        <p className="text-[13px] text-muted-foreground">
          La demande est calculée automatiquement depuis YouTube :
          vitesse de croissance des vues (40 %), écart avec la moyenne habituelle de la chaîne (40 %), nombre de vidéos qui surperforment (20 %).
          Chaque composante est normalisée en percentile au sein de la niche.
        </p>
      </section>

      {/* Thresholds */}
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Seuils de phase</h2>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            Valeurs par défaut
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="scoring-1" className="text-[12px] text-muted-foreground block mb-1">
              Croissance Trends pour Phase 2 (%)
            </label>
            <input
              id="scoring-1"
              type="number"
              value={thresholds.phase2TrendsGrowth}
              onChange={(e) => setThresholds((t) => ({ ...t, phase2TrendsGrowth: Number(e.target.value) }))}
              className="h-9 w-full px-3 border border-border rounded-lg bg-card text-[13px] text-foreground"
            />
          </div>
          <div>
            <label htmlFor="scoring-2" className="text-[12px] text-muted-foreground block mb-1">
              Offre qualifiée max pour Phase 2 (× la médiane de la niche)
            </label>
            <input
              id="scoring-2"
              type="number"
              value={thresholds.phase2MaxSupply}
              onChange={(e) => setThresholds((t) => ({ ...t, phase2MaxSupply: Number(e.target.value) }))}
              className="h-9 w-full px-3 border border-border rounded-lg bg-card text-[13px] text-foreground"
            />
          </div>
          <div>
            <label htmlFor="scoring-3" className="text-[12px] text-muted-foreground block mb-1">
              Vidéos qualifiées en 72h pour Phase 3
            </label>
            <input
              id="scoring-3"
              type="number"
              value={thresholds.phase3QualifiedIn72h}
              onChange={(e) => setThresholds((t) => ({ ...t, phase3QualifiedIn72h: Number(e.target.value) }))}
              className="h-9 w-full px-3 border border-border rounded-lg bg-card text-[13px] text-foreground"
            />
          </div>
        </div>
      </section>

      {/* Top 10 preview */}
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5">
        <h2 className="text-[15px] font-semibold mb-3">Top 10 actuel</h2>
        {topTen.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Aucun sujet scoré.</p>
        ) : (
          <div className="space-y-1">
            {topTen.map((t, i) => (
              <div key={t.id} className="flex items-center gap-3 h-8 text-[13px]">
                <span className="w-5 text-right tabular-nums text-muted-foreground font-medium">
                  {i + 1}
                </span>
                <span className={`w-2 h-2 rounded-full bg-phase-${t.phase}`} />
                <span className="flex-1 truncate">{t.label}</span>
                <span className="text-[11px] text-muted-foreground">{t.nicheName}</span>
                <span className="w-12 text-right tabular-nums font-medium">
                  {t.mgi != null ? Math.round(t.mgi) : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Save button */}
      {isModified && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="h-9 px-4 rounded-lg border border-border bg-card text-foreground text-[13px] font-medium hover:bg-muted transition-colors cursor-pointer"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  );
}
