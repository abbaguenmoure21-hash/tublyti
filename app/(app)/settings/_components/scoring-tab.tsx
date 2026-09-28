'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { saveScoringSettings } from '@/lib/actions/settings';
import type { ScoringSettings } from '@/lib/scoring/scoring-config';
import { PHASE_LABELS } from '@/components/tublyti';

interface TopTenItem {
  id: string;
  label: string;
  nicheName: string;
  phase: number;
  mgi: number;
}

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-[13px] text-foreground w-24 shrink-0">{label}</label>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="flex-1 accent-primary h-1.5"
      />
      <span className="text-[13px] tabular-nums text-muted-foreground w-12 text-right">
        {(value * 100).toFixed(0)} %
      </span>
    </div>
  );
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
  const [weights, setWeights] = useState(scoring.mgiWeights);
  const [thresholds, setThresholds] = useState(scoring.thresholds);
  const [isPending, startTransition] = useTransition();

  const weightSum = weights.trends + weights.ytViews + weights.social;
  const isModified =
    JSON.stringify({ weights, thresholds }) !==
    JSON.stringify({ weights: scoring.mgiWeights, thresholds: scoring.thresholds });

  function handleSave() {
    startTransition(async () => {
      const result = await saveScoringSettings({
        mgiWeights: weights,
        thresholds,
      });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Paramètres de scoring enregistrés.');
      }
    });
  }

  function handleReset() {
    setWeights(defaultScoring.mgiWeights);
    setThresholds(defaultScoring.thresholds);
  }

  return (
    <div className="space-y-6">
      {/* Weights */}
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Poids de la demande (D)</h2>
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            Valeurs par défaut
          </button>
        </div>

        <WeightSlider
          label="Google Trends"
          value={weights.trends}
          onChange={(v) => setWeights((w) => ({ ...w, trends: v }))}
        />
        <WeightSlider
          label="Vues YouTube"
          value={weights.ytViews}
          onChange={(v) => setWeights((w) => ({ ...w, ytViews: v }))}
        />
        <WeightSlider
          label="HN + Stack"
          value={weights.social}
          onChange={(v) => setWeights((w) => ({ ...w, social: v }))}
        />

        {Math.abs(weightSum - 1.0) > 0.01 && (
          <p className="text-[12px] text-destructive">
            La somme doit être 100 % (actuellement {(weightSum * 100).toFixed(0)} %).
          </p>
        )}
      </section>

      {/* Thresholds */}
      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5 space-y-4">
        <h2 className="text-[15px] font-semibold">Seuils de phase</h2>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-[12px] text-muted-foreground block mb-1">
              Croissance Trends pour Phase 2 (%)
            </label>
            <input
              type="number"
              value={thresholds.phase2TrendsGrowth}
              onChange={(e) => setThresholds((t) => ({ ...t, phase2TrendsGrowth: Number(e.target.value) }))}
              className="h-9 w-full px-3 border border-border rounded-lg bg-card text-[13px] text-foreground"
            />
          </div>
          <div>
            <label className="text-[12px] text-muted-foreground block mb-1">
              Max supply pour Phase 2
            </label>
            <input
              type="number"
              value={thresholds.phase2MaxSupply}
              onChange={(e) => setThresholds((t) => ({ ...t, phase2MaxSupply: Number(e.target.value) }))}
              className="h-9 w-full px-3 border border-border rounded-lg bg-card text-[13px] text-foreground"
            />
          </div>
          <div>
            <label className="text-[12px] text-muted-foreground block mb-1">
              Vidéos qualifiées en 72h pour Phase 3
            </label>
            <input
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
                  {Math.round(t.mgi)}
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
            disabled={isPending || Math.abs(weightSum - 1.0) > 0.01}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  );
}
