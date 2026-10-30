'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy, Check, Download, AlertTriangle } from 'lucide-react';
import { generateAngles } from '@/lib/actions/angles';
import { getAiBudgetStatus, type AiBudgetStatus } from '@/lib/actions/ai-spend';
import { estimateAngleCostUSD } from '@/lib/nlp/angle-costs';
import { createVideoFromTopic, undoCreateVideo } from '@/lib/actions/sujets';
import { copyBrief, downloadBrief, type BriefData } from './brief';

interface Angle {
  id: string;
  title: string;
  hook: string;
  rationale: string;
  status: string;
  video_id: string | null;
  created_at: string;
}

export type { BriefData };

export function AngleSection({
  topicId,
  angles,
  briefData,
  canGenerate = false,
}: {
  topicId: string;
  angles: Angle[];
  briefData: BriefData;
  /** Génération d'angles (IA payante) : réservée à l'administration. */
  canGenerate?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [choosing, startChoose] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedAngleId, setSelectedAngleId] = useState<string | null>(null);
  const [showAllAngles, setShowAllAngles] = useState(false);
  const [budget, setBudget] = useState<AiBudgetStatus | null>(null);
  const [loadingBudget, setLoadingBudget] = useState(false);

  const estimatedCost = estimateAngleCostUSD();

  function handleGenerateClick() {
    setLoadingBudget(true);
    setShowConfirm(true);
    getAiBudgetStatus().then((status) => {
      setBudget(status);
      setLoadingBudget(false);
    });
  }

  function handleConfirm() {
    setShowConfirm(false);
    startTransition(async () => {
      const result = await generateAngles(topicId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Angles générés. Coût : $${result.costUSD?.toFixed(4) ?? '?'}`);
    });
  }

  async function handleCopyBrief(angle: Angle) {
    if (await copyBrief(angle, briefData)) {
      setCopiedId(angle.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  function handleDownloadBrief(angle: Angle) {
    downloadBrief(angle, briefData);
  }

  /** « Choisir » : same action as « Créer cette vidéo », with this angle. */
  function handleChoose(angle: Angle) {
    if (choosing) return;
    startChoose(async () => {
      const res = await createVideoFromTopic(topicId, angle.id);
      if ('error' in res && res.error) {
        toast.error(res.error);
        return;
      }
      const created = res as { videoId: string; existing?: boolean };
      if (created.existing) {
        toast('Ce sujet est déjà dans Mes vidéos', {
          action: { label: 'Ouvrir', onClick: () => router.push('/pipeline') },
        });
        return;
      }
      toast.success('Vidéo ajoutée à Mes vidéos', {
        description: angle.title,
        action: { label: 'Annuler', onClick: () => void undoCreateVideo(created.videoId).then(() => router.refresh()) },
        cancel: { label: 'Ouvrir', onClick: () => router.push('/pipeline') },
      });
      router.refresh();
    });
  }

  const overBudget = budget ? budget.remainingUSD < estimatedCost : false;
  const selectedAngle = selectedAngleId ? angles.find((a) => a.id === selectedAngleId) : null;

  const angleCards = angles.map((a, i) => {
    const isSelected = a.status === 'in_production' || a.status === 'published';
    return (
      <div
        key={a.id}
        className={`px-5 py-4 border-b border-border flex flex-col gap-2 last:border-0 hover:bg-muted/40 transition-colors ${
          isSelected ? 'bg-primary/5' : ''
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[12px] font-bold text-primary tabular-nums bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
            {String(i + 1).padStart(2, '0')}
          </span>
          <span className="text-[14px] font-semibold leading-snug">{a.title}</span>
        </div>
        {a.hook && (
          <p className="text-[13px] leading-relaxed text-muted-foreground/90 pl-9 line-clamp-2">{a.hook}</p>
        )}
        <div className="flex gap-2 pt-1.5 pl-9">
          <button
            type="button"
            onClick={() => (isSelected ? undefined : handleChoose(a))}
            disabled={choosing}
            aria-pressed={isSelected}
            className={`haptic-btn h-[28px] px-3 rounded-md text-[12px] font-semibold transition-colors cursor-pointer shadow-sm ${
              isSelected
                ? 'bg-primary text-primary-foreground border border-primary/20'
                : 'bg-background border border-border text-foreground hover:bg-muted'
            }`}
          >
            {isSelected ? 'Retenu' : 'Choisir'}
          </button>
          <button
            type="button"
            onClick={() => handleCopyBrief(a)}
            className="haptic-btn h-[28px] px-3 bg-background border border-border rounded-md text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            {copiedId === a.id ? (
              <>
                <Check className="w-3.5 h-3.5 text-success" />
                Copié !
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copier
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleDownloadBrief(a)}
            className="haptic-btn h-[28px] px-3 bg-background border border-border rounded-md text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Télécharger
          </button>
          <button
            type="button"
            onClick={() => setSelectedAngleId(a.id)}
            className="haptic-btn h-[28px] px-3 ml-auto bg-background border border-border rounded-md text-[12px] font-semibold text-primary hover:bg-primary/5 transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            Détails
          </button>
        </div>
      </div>
    );
  });

  return (
    <>
      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-[10px] shadow-lg w-[380px] p-5 flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold">Confirmer la génération</h3>

            {loadingBudget ? (
              <div className="text-[13px] text-muted-foreground">Chargement du budget…</div>
            ) : budget ? (
              <div className="flex flex-col gap-3">
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground">Coût estimé</span>
                  <span className="font-medium tabular-nums">${estimatedCost.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground">Dépensé ce mois</span>
                  <span className="tabular-nums">${budget.spentThisMonthUSD.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground">Budget restant</span>
                  <span className={`font-medium tabular-nums ${overBudget ? 'text-[var(--destructive)]' : 'text-[var(--success)]'}`}>
                    ${budget.remainingUSD.toFixed(2)}
                  </span>
                </div>
                {/* Budget gauge */}
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min((budget.spentThisMonthUSD / budget.budgetLimitUSD) * 100, 100)}%`,
                      backgroundColor: overBudget ? 'var(--destructive)' : 'var(--primary)',
                    }}
                  />
                </div>
                <div className="text-[11px] text-muted-foreground text-right">
                  ${budget.spentThisMonthUSD.toFixed(2)} / ${budget.budgetLimitUSD.toFixed(2)}
                </div>

                {overBudget && (
                  <div className="flex items-center gap-2 text-[12px] text-[var(--destructive)]">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Budget insuffisant pour cette génération.
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="h-8 px-3 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loadingBudget || overBudget}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
              >
                Générer 5 angles
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Angle Details modal */}
      {selectedAngle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card border border-border rounded-[10px] shadow-lg w-full max-w-xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto relative animate-in fade-in zoom-in-95 duration-200">
            <button 
              type="button" 
              onClick={() => setSelectedAngleId(null)}
              className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            
            <div className="flex items-start gap-3 pr-8">
               <span className="text-[13px] font-bold text-primary tabular-nums bg-primary/10 px-2 py-1 rounded border border-primary/20 shrink-0 mt-0.5">
                 {String(angles.findIndex(a => a.id === selectedAngle.id) + 1).padStart(2, '0')}
               </span>
               <h3 className="text-[18px] font-semibold leading-snug">{selectedAngle.title}</h3>
            </div>
            
            <div className="flex flex-col gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Accroche (Hook)</span>
              <p className="text-[14px] text-foreground/90 leading-relaxed bg-muted p-3.5 rounded-md border border-border shadow-sm">
                {selectedAngle.hook}
              </p>
            </div>
            
            {selectedAngle.rationale && (
              <div className="flex flex-col gap-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Justification & Stratégie</span>
                <p className="text-[13.5px] text-muted-foreground/90 leading-relaxed whitespace-pre-wrap bg-muted/40 p-3.5 rounded-md border border-border">
                  {selectedAngle.rationale}
                </p>
              </div>
            )}
            
            <div className="flex gap-2 justify-end mt-2 pt-5 border-t border-border">
              <button
                type="button"
                onClick={() => setSelectedAngleId(null)}
                className="haptic-btn h-9 px-4 rounded-md text-[13px] font-semibold text-foreground bg-background border border-border hover:bg-muted transition-colors cursor-pointer shadow-sm"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* All Angles modal */}
      {showAllAngles && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-card border border-border rounded-[10px] shadow-lg w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden relative animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40 sticky top-0 z-10">
              <h2 className="text-headline">Tous les angles proposés ({angles.length})</h2>
              <button 
                type="button" 
                onClick={() => setShowAllAngles(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="overflow-y-auto flex flex-col">
              {angleCards}
            </div>
          </div>
        </div>
      )}

      <section className="rounded-xl bg-card overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <h2 className="text-headline">Angles proposés</h2>
          {canGenerate && (
          <button
            type="button"
            onClick={handleGenerateClick}
            disabled={isPending}
            className="haptic-btn h-[28px] px-3 bg-background border border-border rounded-md text-foreground text-[12px] font-semibold hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
          >
            {isPending ? 'Génération…' : angles.length > 0 ? 'Régénérer' : `Générer 5 angles (~$${estimatedCost.toFixed(3)})`}
          </button>
          )}
        </div>

        {angles.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] font-medium text-muted-foreground">
            {canGenerate ? 'Aucun angle généré. Clique sur « Générer » pour en créer.' : 'Pas encore d’angle proposé pour ce sujet. Les angles sont ajoutés par l’équipe TubLyTI.'}
          </div>
        ) : (
          <>
            <div className="flex flex-col">
              {angleCards.slice(0, 3)}
            </div>
            {angles.length > 3 && (
              <div className="p-3 bg-muted/40 flex justify-center border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAllAngles(true)}
                  className="text-[13px] font-medium text-primary hover:underline cursor-pointer"
                >
                  Voir les {angles.length} angles
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
