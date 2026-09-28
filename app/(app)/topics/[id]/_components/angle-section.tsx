'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Copy, Check, Download, AlertTriangle } from 'lucide-react';
import { generateAngles } from '@/lib/actions/angles';
import { getAiBudgetStatus, type AiBudgetStatus } from '@/lib/actions/ai-spend';
import { estimateAngleCostUSD } from '@/lib/nlp/angle-costs';

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
}: {
  topicId: string;
  angles: Angle[];
  briefData: BriefData;
}) {
  const [isPending, startTransition] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
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

  return (
    <>
      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-[10px] shadow-lg w-[380px] p-5 flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold">Confirmer la g\u00e9n\u00e9ration</h3>

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
          </div>
        </div>
      )}

      <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] flex flex-col">
        <div className="flex items-center justify-between px-[18px] py-3.5 border-b border-border">
          <h2 className="text-[15px] font-semibold">Angles propos\u00e9s</h2>
          <button
            type="button"
            onClick={handleGenerateClick}
            disabled={isPending}
            className="h-7 px-2.5 border border-border rounded-md bg-card text-foreground text-[12px] font-medium hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isPending ? 'G\u00e9n\u00e9ration\u2026' : angles.length > 0 ? 'R\u00e9g\u00e9n\u00e9rer' : `G\u00e9n\u00e9rer 5 angles (~$${estimatedCost.toFixed(3)})`}
          </button>
        </div>

        {angles.length === 0 ? (
          <div className="px-[18px] py-8 text-center text-[14px] text-muted-foreground">
            Aucun angle g\u00e9n\u00e9r\u00e9. Clique sur \u00ab G\u00e9n\u00e9rer \u00bb pour en cr\u00e9er.
          </div>
        ) : (
          angles.map((a, i) => {
            const isSelected = a.status === 'in_production' || a.status === 'published';
            return (
              <div
                key={a.id}
                className={`px-[18px] py-3.5 border-b border-muted flex flex-col gap-1.5 last:border-0 ${
                  isSelected ? 'bg-primary-soft/40' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-primary-ink tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[14px] font-semibold">{a.title}</span>
                </div>
                {a.hook && (
                  <p className="text-[13px] leading-[1.45] text-muted-foreground">{a.hook}</p>
                )}
                <div className="flex gap-2 pt-0.5">
                  <button
                    type="button"
                    className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-primary-soft text-primary-ink hover:bg-primary-soft/80'
                    }`}
                  >
                    {isSelected ? 'Retenu' : 'Choisir'}
                  </button>
                  <button
                    type="button"
                    data-action="copy-brief"
                    onClick={() => handleCopyBrief(a)}
                    className="h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
                  >
                    {copiedId === a.id ? (
                      <>
                        <Check className="w-3 h-3" />
                        Copi\u00e9 !
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copier
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadBrief(a)}
                    className="h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" />
                    .md
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}
