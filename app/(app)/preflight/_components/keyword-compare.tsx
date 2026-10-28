'use client';

import { useState, useTransition } from 'react';
import { BarChart3, Loader2, Plus, Trophy, X } from 'lucide-react';
import { compareKeywordsAction } from '@/lib/actions/preflight';
import type { KeywordComparison } from '@/lib/keywords';

const nf = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const times = (m: number) => `×${m.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;

/** « Quel mot attire le plus ? » : compare 2 à 4 mots-clés sur les vidéos du catalogue. */
export function KeywordCompare({ userChannelId }: { userChannelId: string }) {
  const [terms, setTerms] = useState<string[]>(['', '']);
  const [scope, setScope] = useState<'niche' | 'all'>('niche');
  const [res, setRes] = useState<KeywordComparison | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setErr(null);
    start(async () => {
      const r = await compareKeywordsAction(userChannelId, terms, scope);
      if (r.ok) setRes(r.data);
      else setErr(r.message);
    });
  }

  const max = Math.max(1, ...(res?.stats.map((s) => s.medianScore ?? 0) ?? [1]));
  return (
    <section aria-labelledby="kw-titre" className="flex flex-col gap-3">
      <div>
        <h2 id="kw-titre" className="text-lg font-semibold">Quel mot attire le plus ?</h2>
        <p className="text-[13px] text-muted-foreground">
          Compare 2 à 4 mots ou sujets (ex. « Rome », « Égypte », « Aztèques »). TubLyTI regarde les vidéos qui les ont dans leur titre et combien elles font par rapport aux vues habituelles de leur chaîne : c’est la demande propre au mot.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="elev-1 flex flex-col gap-3 rounded-[22px] bg-card p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          {terms.map((t, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                value={t}
                onChange={(e) => setTerms((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Mot ${i + 1}`}
                aria-label={`Mot ${i + 1}`}
                maxLength={60}
                className="h-10 w-40 rounded-[10px] border border-input bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              {terms.length > 2 && (
                <button type="button" onClick={() => setTerms((xs) => xs.filter((_, j) => j !== i))} aria-label="Retirer ce mot" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {i < terms.length - 1 && <span className="px-1 text-[13px] text-muted-foreground">vs</span>}
            </div>
          ))}
          {terms.length < 4 && (
            <button type="button" onClick={() => setTerms((xs) => [...xs, ''])} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Ajouter
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="well inline-flex rounded-[10px] bg-muted/60 p-0.5 text-[13px]" role="radiogroup" aria-label="Où chercher">
            {(['niche', 'all'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={scope === k}
                onClick={() => setScope(k)}
                className={`rounded-[8px] px-3 py-1.5 ${scope === k ? 'elev-1 bg-card font-medium' : 'text-muted-foreground'}`}
              >
                {k === 'niche' ? 'Ma niche' : 'Toutes les niches'}
              </button>
            ))}
          </div>
          <button type="submit" disabled={pending || terms.filter((t) => t.trim().length >= 2).length < 2} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <BarChart3 className="h-4 w-4" aria-hidden="true" />}
            Comparer
          </button>
          {err && <span role="alert" className="text-[13px] text-destructive">{err}</span>}
        </div>

        {res && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <p role="status" className="text-[14px] font-medium leading-relaxed">{res.verdict}</p>
            <ul className="flex flex-col gap-3">
              {res.stats.map((s) => (
                <li key={s.term} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
                    <span className="flex items-center gap-1.5 font-medium">
                      {res.winner === s.term && <Trophy className="h-3.5 w-3.5 text-primary-ink" aria-hidden="true" />}« {s.term} »
                    </span>
                    <span className="text-[13px] tabular-nums text-muted-foreground">
                      {s.medianScore !== null ? `${times(s.medianScore)} en médiane` : 'pas de mesure'}
                      {s.share2x !== null ? ` · ${Math.round(s.share2x * 100)} % à ×2+` : ''}
                      {s.medianViews ? ` · ~${nf.format(s.medianViews)} vues` : ''}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className={`h-full rounded-full ${res.winner === s.term ? 'bg-primary' : 'bg-[var(--chart-2)]'}`} style={{ width: `${Math.round(((s.medianScore ?? 0) / max) * 100)}%` }} />
                  </div>
                  <span className="text-[12px] text-muted-foreground">
                    {s.videos} vidéo{s.videos > 1 ? 's' : ''} de {s.channels} chaîne{s.channels > 1 ? 's' : ''} · {s.recent90d} ces 90 derniers jours
                  </span>
                  {s.best.length > 0 && (
                    <span className="flex flex-col gap-0.5 text-[12px]">
                      {s.best.map((b) => (
                        <a key={b.videoId} href={`https://www.youtube.com/watch?v=${b.videoId}`} target="_blank" rel="noreferrer" className="truncate text-muted-foreground hover:text-foreground hover:underline">
                          {times(b.score)} · {b.title}
                        </a>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </section>
  );
}
