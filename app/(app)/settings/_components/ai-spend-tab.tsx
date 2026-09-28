'use client';

import { useState, useEffect } from 'react';
import { getAiBudgetStatus, getAiSpendHistory, type AiBudgetStatus, type AiSpendEntry } from '@/lib/actions/ai-spend';

const ACTION_LABELS: Record<string, string> = {
  generate_angles: 'Angles',
  classify_comments: 'Classification',
  title_analysis: 'Analyse titres',
  niche_dossier: 'Dossier niche',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AiSpendTab() {
  const [budget, setBudget] = useState<AiBudgetStatus | null>(null);
  const [history, setHistory] = useState<AiSpendEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAiBudgetStatus(), getAiSpendHistory(30)]).then(
      ([b, h]) => {
        setBudget(b);
        setHistory(h.data);
        setLoading(false);
      },
    );
  }, []);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5">
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        <div className="mt-4 h-3 w-full bg-muted rounded animate-pulse" />
        <div className="mt-3 h-3 w-3/4 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  const usagePercent = budget
    ? Math.min((budget.spentThisMonthUSD / budget.budgetLimitUSD) * 100, 100)
    : 0;
  const isOverBudget = budget ? budget.remainingUSD <= 0 : false;

  return (
    <div className="flex flex-col gap-4">
      {/* Budget gauge */}
      <div className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)] p-5 flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold">Budget IA mensuel</h2>

        {budget && (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-[36px] font-semibold tabular-nums tracking-[-0.02em]">
                ${budget.spentThisMonthUSD.toFixed(2)}
              </span>
              <span className="text-[14px] text-muted-foreground">
                / ${budget.budgetLimitUSD.toFixed(2)}
              </span>
            </div>

            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${usagePercent}%`,
                  backgroundColor: isOverBudget
                    ? 'var(--destructive)'
                    : usagePercent > 80
                      ? 'var(--warning)'
                      : 'var(--primary)',
                }}
              />
            </div>

            <div className="flex justify-between text-[12px] text-muted-foreground">
              <span>
                {isOverBudget
                  ? 'Budget d\u00e9pass\u00e9'
                  : `${budget.remainingUSD.toFixed(2)} $ restant`}
              </span>
              <span>{Math.round(usagePercent)} % utilis\u00e9</span>
            </div>
          </>
        )}
      </div>

      {/* Spend history */}
      <div className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)]">
        <div className="px-5 py-3.5 border-b border-border">
          <h2 className="text-[15px] font-semibold">Historique des d\u00e9penses</h2>
        </div>

        {history.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-muted-foreground">
            Aucune d\u00e9pense IA enregistr\u00e9e.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {history.map((entry) => (
              <div key={entry.id} className="px-5 py-3 flex items-center gap-3 text-[13px]">
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                    {entry.topicLabel && (
                      <span className="text-muted-foreground truncate">
                        \u2014 {entry.topicLabel}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex gap-2">
                    <span>{formatDate(entry.createdAt)}</span>
                    <span>\u00b7</span>
                    <span>{entry.model}</span>
                    <span>\u00b7</span>
                    <span className="tabular-nums">
                      {entry.tokensIn.toLocaleString('fr-FR')} in / {entry.tokensOut.toLocaleString('fr-FR')} out
                    </span>
                  </div>
                </div>
                <span className="font-medium tabular-nums shrink-0">
                  ${entry.costUSD.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
