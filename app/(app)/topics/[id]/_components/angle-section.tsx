'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Copy, Check, Download, AlertTriangle } from 'lucide-react';
import { generateAngles } from '@/lib/actions/angles';
import { getAiBudgetStatus, type AiBudgetStatus } from '@/lib/actions/ai-spend';
import { estimateAngleCostUSD } from '@/lib/nlp/angle-costs';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface Angle {
  id: string;
  title: string;
  hook: string;
  rationale: string;
  status: string;
  video_id: string | null;
  created_at: string;
}

export interface BriefData {
  topicLabel: string;
  nicheName: string;
  rpmCoefficient: number;
  phaseLabel: string;
  mgi: number | null;
  demand: number | null;
  supply: number | null;
  frustrationScore: number | null;
  monetization: number | null;
  date: string;
  frustrations: {
    text: string;
    likeCount: number;
    requestedAngle: string | null;
    commentId: string;
    videoId?: string;
  }[];
  competitors: {
    title: string;
    channelTitle: string;
    views: number;
    videoId: string;
  }[];
}

function buildBrief(angle: Angle, data: BriefData): string {
  const lines: string[] = [
    `# Brief \u2014 ${angle.title}`,
    '',
    `**Date :** ${data.date}`,
    `**Sujet :** ${data.topicLabel}`,
    `**Niche :** ${data.nicheName} (RPM \u00d7${data.rpmCoefficient})`,
    `**Phase :** ${data.phaseLabel}`,
    '',
    `## Scores MGI`,
    '',
    data.mgi !== null ? `- **MGI global :** ${Math.round(data.mgi)}` : '',
    data.demand !== null ? `- **Demande (D) :** ${Math.round(data.demand)}` : '',
    data.supply !== null ? `- **Offre qualifi\u00e9e (O_q) :** ${Number(data.supply).toFixed(1)}` : '',
    data.frustrationScore !== null ? `- **Frustration (F) :** ${(Number(data.frustrationScore) * 100).toFixed(0)} %` : '',
    data.monetization !== null ? `- **Mon\u00e9tisation (P) :** \u00d7${Number(data.monetization).toFixed(1)}` : '',
    '',
    `## Angle choisi`,
    '',
    `**Titre :** ${angle.title}`,
    `**Hook :** ${angle.hook}`,
    `**Rationale :** ${angle.rationale}`,
    '',
    `## Frustrations sources (top ${Math.min(data.frustrations.length, 10)})`,
    '',
  ].filter(Boolean);

  for (const f of data.frustrations.slice(0, 10)) {
    const angleNote = f.requestedAngle ? ` \u2192 ${f.requestedAngle}` : '';
    const link = f.videoId
      ? ` ([commentaire](https://www.youtube.com/watch?v=${f.videoId}&lc=${f.commentId}))`
      : '';
    lines.push(`- [${f.likeCount} likes] ${f.text.slice(0, 200)}${angleNote}${link}`);
  }

  lines.push('', `## Vid\u00e9os concurrentes (top ${Math.min(data.competitors.length, 5)})`, '');
  for (const c of data.competitors.slice(0, 5)) {
    const views = c.views >= 1000 ? `${(c.views / 1000).toFixed(1)}k` : String(c.views);
    lines.push(
      `- ${c.title} (${c.channelTitle}) \u2014 ${views} vues ([lien](https://www.youtube.com/watch?v=${c.videoId}))`,
    );
  }

  return lines.join('\n');
}

function downloadMd(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
  const [isPending, startTransition] = useTransition();
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
      toast.success(`Angles g\u00e9n\u00e9r\u00e9s. Co\u00fbt : $${result.costUSD?.toFixed(4) ?? '?'}`);
    });
  }

  async function handleCopyBrief(angle: Angle) {
    const brief = buildBrief(angle, briefData);
    await navigator.clipboard.writeText(brief);
    setCopiedId(angle.id);
    toast.success('Brief copi\u00e9 dans le presse-papiers.');
    setTimeout(() => setCopiedId(null), 2000);
  }

  function handleDownloadBrief(angle: Angle) {
    const brief = buildBrief(angle, briefData);
    const slug = briefData.topicLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40);
    downloadMd(`brief-${slug}.md`, brief);
    toast.success('Brief t\u00e9l\u00e9charg\u00e9.');
  }

  const overBudget = budget ? budget.remainingUSD < estimatedCost : false;
  const selectedAngle = selectedAngleId ? angles.find((a) => a.id === selectedAngleId) : null;

  const angleCards = angles.map((a, i) => {
    const isSelected = a.status === 'in_production' || a.status === 'published';
    return (
      <div
        key={a.id}
        className={`px-5 py-4 border-b border-[--glass-border] flex flex-col gap-2 last:border-0 hover:bg-[--bg-surface-1]/30 transition-colors ${
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
            className={`haptic-btn h-[28px] px-3 rounded-md text-[12px] font-semibold transition-colors cursor-pointer shadow-sm ${
              isSelected
                ? 'bg-primary text-primary-foreground border border-primary/20'
                : 'bg-[--bg-surface-2] border border-[--glass-border] text-foreground hover:bg-[--bg-surface-1]'
            }`}
          >
            {isSelected ? 'Retenu' : 'Choisir'}
          </button>
          <button
            type="button"
            data-action="copy-brief"
            onClick={() => handleCopyBrief(a)}
            className="haptic-btn h-[28px] px-3 bg-[--bg-surface-2] border border-[--glass-border] rounded-md text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
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
            className="haptic-btn h-[28px] px-3 bg-[--bg-surface-2] border border-[--glass-border] rounded-md text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            .md
          </button>
          <button
            type="button"
            onClick={() => setSelectedAngleId(a.id)}
            className="haptic-btn h-[28px] px-3 ml-auto bg-[--bg-surface-2] border border-[--glass-border] rounded-md text-[12px] font-semibold text-primary hover:bg-primary/5 transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            Détails
          </button>
        </div>
      </div>
    );
  });

  // Rendered inside the « Tous les angles » dialog when it is open so Base UI treats it as a nested dialog.
  const detailsDialog = (
      <Dialog open={!!selectedAngle} onOpenChange={(open) => { if (!open) setSelectedAngleId(null); }}>
        {selectedAngle && (
          <DialogContent showCloseButton={false} className="bg-card border border-border rounded-[10px] shadow-lg w-[calc(100vw-32px)] max-w-xl sm:max-w-xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setSelectedAngleId(null)}
              aria-label="Fermer"
              className="absolute top-4 right-4 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer after:absolute after:-inset-2 md:after:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            
            <div className="flex items-start gap-3 pr-8">
               <span className="text-[13px] font-bold text-primary tabular-nums bg-primary/10 px-2 py-1 rounded border border-primary/20 shrink-0 mt-0.5">
                 {String(angles.findIndex(a => a.id === selectedAngle.id) + 1).padStart(2, '0')}
               </span>
               <DialogTitle className="text-[18px] font-semibold leading-snug">{selectedAngle.title}</DialogTitle>
            </div>
            
            <div className="flex flex-col gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Accroche (Hook)</span>
              <p className="text-[14px] text-foreground/90 leading-relaxed bg-[--bg-surface-1] p-3.5 rounded-md border border-[--glass-border] shadow-sm">
                {selectedAngle.hook}
              </p>
            </div>
            
            {selectedAngle.rationale && (
              <div className="flex flex-col gap-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Justification & Stratégie</span>
                <p className="text-[13.5px] text-muted-foreground/90 leading-relaxed whitespace-pre-wrap bg-[--bg-surface-1]/50 p-3.5 rounded-md border border-[--glass-border]">
                  {selectedAngle.rationale}
                </p>
              </div>
            )}
            
            <div className="flex gap-2 justify-end mt-2 pt-5 border-t border-[--glass-border]">
              <button
                type="button"
                onClick={() => setSelectedAngleId(null)}
                className="haptic-btn h-9 px-4 rounded-md text-[13px] font-semibold text-foreground bg-[--bg-surface-2] border border-[--glass-border] hover:bg-muted transition-colors cursor-pointer shadow-sm"
              >
                Fermer
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
  );

  return (
    <>
      {/* Confirmation modal */}
      <Dialog open={showConfirm} onOpenChange={(open) => { if (!open) setShowConfirm(false); }}>
          <DialogContent showCloseButton={false} className="w-[min(380px,calc(100vw-32px))] max-w-none sm:max-w-none bg-card border border-border rounded-[10px] shadow-lg p-5 flex flex-col gap-4">
            <DialogTitle className="text-[15px] font-semibold leading-normal">Confirmer la g\u00e9n\u00e9ration</DialogTitle>

            {loadingBudget ? (
              <div className="text-[13px] text-muted-foreground">Chargement du budget\u2026</div>
            ) : budget ? (
              <div className="flex flex-col gap-3">
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground">Co\u00fbt estim\u00e9</span>
                  <span className="font-medium tabular-nums">${estimatedCost.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-muted-foreground">D\u00e9pens\u00e9 ce mois</span>
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
                    Budget insuffisant pour cette g\u00e9n\u00e9ration.
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
                G\u00e9n\u00e9rer 5 angles
              </button>
            </div>
          </DialogContent>
      </Dialog>

      {/* Angle Details modal (nested inside « Tous les angles » when that one is open) */}
      {!showAllAngles && detailsDialog}

      {/* All Angles modal */}
      <Dialog open={showAllAngles} onOpenChange={(open) => { if (!open) setShowAllAngles(false); }}>
          <DialogContent showCloseButton={false} className="bg-card border border-border rounded-[10px] shadow-lg w-[calc(100vw-32px)] max-w-2xl sm:max-w-2xl p-0 gap-0 flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[--glass-border] bg-[--bg-surface-1]/50 sticky top-0 z-10">
              <DialogTitle render={<h2 />} className="text-headline">Tous les angles proposés ({angles.length})</DialogTitle>
              <button
                type="button"
                onClick={() => setShowAllAngles(false)}
                aria-label="Fermer"
                className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer after:absolute after:-inset-2 md:after:hidden"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="overflow-y-auto flex flex-col">
              {angleCards}
            </div>
            {showAllAngles && detailsDialog}
          </DialogContent>
      </Dialog>

      <section className="bento-card !p-0 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[--glass-border] bg-[--bg-surface-1]/50">
          <h2 className="text-headline">Angles proposés</h2>
          {canGenerate && (
          <button
            type="button"
            onClick={handleGenerateClick}
            disabled={isPending}
            className="haptic-btn h-[28px] px-3 bg-[--bg-surface-2] border border-[--glass-border] rounded-md text-foreground text-[12px] font-semibold hover:bg-[--bg-surface-1] transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
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
              <div className="p-3 bg-[--bg-surface-1]/30 flex justify-center border-t border-[--glass-border]">
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
