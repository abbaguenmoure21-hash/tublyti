'use client';

import { useState } from 'react';

interface TitlePattern {
  id: string;
  formula: string;
  description: string;
  examples: string[];
  frequency: number;
  emotionalTriggers: string[];
  avgLength: number | null;
  nicheName: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  curiosity: 'Curiosité',
  fear: 'Peur',
  urgency: 'Urgence',
  aspiration: 'Aspiration',
  contrarian: 'Contraire',
  social_proof: 'Preuve sociale',
  scarcity: 'Rareté',
  authority: 'Autorité',
  fomo: 'FOMO',
  relief: 'Soulagement',
};

const FORMULA_LABELS: Record<string, string> = {
  question: 'Question',
  number_list: 'Liste chiffrée',
  how_i: 'How I…',
  why: 'Why…',
  comparison: 'Comparaison',
  challenge: 'Défi',
  revelation: 'Révélation',
  story: 'Récit',
  authority: 'Autorité',
  urgency: 'Urgence',
  negative: 'Négatif',
  superlative: 'Superlatif',
};

export function TitlePatternsView({ patterns }: { patterns: TitlePattern[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (patterns.length === 0) return null;

  // Group by niche
  const byNiche = new Map<string, TitlePattern[]>();
  for (const p of patterns) {
    if (!byNiche.has(p.nicheName)) byNiche.set(p.nicheName, []);
    byNiche.get(p.nicheName)!.push(p);
  }

  return (
    <section className="bg-card border border-border rounded-[10px] shadow-[0_1px_2px_rgba(20,24,34,0.06)]">
      <div className="px-5 py-3.5 border-b border-border">
        <h2 className="text-[15px] font-semibold">Formules de titres</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Structures dominantes extraites des vidéos outliers (score ≥ 3×).
        </p>
      </div>

      {[...byNiche.entries()].map(([nicheName, nichePatterns]) => (
        <div key={nicheName}>
          <div className="px-5 py-2 bg-muted/30 border-b border-border">
            <span className="text-[12px] font-medium text-muted-foreground">{nicheName}</span>
          </div>

          <div className="divide-y divide-border">
            {nichePatterns
              .sort((a, b) => b.frequency - a.frequency)
              .map((p) => {
                const isExpanded = expandedId === p.id;
                return (
                  <div key={p.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-primary/10 text-primary min-w-[80px] justify-center">
                        {FORMULA_LABELS[p.formula] ?? p.formula}
                      </span>
                      <span className="flex-1 text-[13px] text-foreground truncate">
                        {p.description}
                      </span>
                      <span className="text-[12px] text-muted-foreground tabular-nums shrink-0">
                        {p.frequency}×
                      </span>
                      {p.avgLength && (
                        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                          ~{p.avgLength} car.
                        </span>
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-3 space-y-2">
                        {/* Emotional triggers */}
                        {p.emotionalTriggers.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {p.emotionalTriggers.map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border border-border text-muted-foreground"
                              >
                                {TRIGGER_LABELS[t] ?? t}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Examples */}
                        <div className="space-y-1">
                          {p.examples.map((ex, i) => (
                            <div key={i} className="text-[12px] text-muted-foreground pl-3 border-l-2 border-primary/20">
                              {ex}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </section>
  );
}
