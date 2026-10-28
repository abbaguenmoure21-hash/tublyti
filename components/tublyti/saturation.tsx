'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { checkOutlierSaturation } from '@/lib/actions/saturation';
import type { OutlierSaturation, SaturationLevel, TopicSaturation } from '@/lib/saturation';

const LABEL: Record<SaturationLevel, string> = { open: 'Ouvert', filling: 'Se remplit', saturated: 'Saturé', unknown: 'À confirmer' };
const TONE: Record<SaturationLevel, string> = {
  open: 'bg-phase-2-soft text-phase-2-ink',
  filling: 'bg-phase-1-soft text-phase-1-ink',
  saturated: 'bg-destructive/10 text-destructive',
  unknown: 'bg-muted text-muted-foreground',
};

/** Carte « Saturation du sujet » de la fiche sujet. */
export function TopicSaturationCard({ s }: { s: TopicSaturation }) {
  return (
    <section className="bento-card flex flex-col gap-3 !px-[18px] !py-4" aria-labelledby="sat-titre">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-semibold ${TONE[s.level]}`}>
          <Layers className="h-4 w-4" aria-hidden="true" /> {LABEL[s.level]}
        </span>
        <h2 id="sat-titre" className="text-[13px] font-semibold">Saturation du sujet{s.score !== null ? ` · ${s.score}/100` : ''}</h2>
        {s.score !== null && (
          <span className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span className={`block h-full rounded-full ${s.level === 'saturated' ? 'bg-destructive' : s.level === 'filling' ? 'bg-warning' : 'bg-phase-2'}`} style={{ width: `${s.score}%` }} />
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground">
        {s.reasons.map((r) => (
          <li key={r}>· {r}</li>
        ))}
      </ul>
      <p className="text-[13px] font-medium">{s.advice}</p>
    </section>
  );
}

/** Bouton « Copiée ? » à côté d'une vidéo qui a sur-performé. */
export function OutlierSaturationButton({ videoId }: { videoId: string }) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<OutlierSaturation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !res && !pending) {
      start(async () => {
        const r = await checkOutlierSaturation(videoId);
        if (r.ok) setRes(r.data);
        else setErr(r.message);
      });
    }
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title="Cette idée a-t-elle déjà été trop copiée ?"
        className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold ${res ? TONE[res.level] : 'bg-muted text-muted-foreground hover:text-foreground'}`}
      >
        <Layers className="h-3 w-3" aria-hidden="true" />
        {res ? LABEL[res.level] : 'Copiée ?'}
      </button>
      {open && (
        <div className="elev-3 absolute right-0 top-full z-30 mt-1.5 w-[320px] rounded-xl border border-border bg-popover p-3 text-[13px] text-popover-foreground">
          {pending && !res ? (
            <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Recherche des copies dans la niche…</span>
          ) : err ? (
            <span className="text-muted-foreground">{err}</span>
          ) : res ? (
            <div className="flex flex-col gap-2">
              <p className="leading-snug">{res.verdict}</p>
              {res.copies > 0 && (
                <p className="text-[12px] text-muted-foreground">
                  {res.copies} vidéo{res.copies > 1 ? 's' : ''} très proche{res.copies > 1 ? 's' : ''} publiée{res.copies > 1 ? 's' : ''} depuis, dont {res.copiesLast30d} ces 30 derniers jours, par {res.copyChannels} chaîne{res.copyChannels > 1 ? 's' : ''}.
                </p>
              )}
              {res.examples.length > 0 && (
                <ul className="flex flex-col gap-1 border-t border-border pt-2">
                  {res.examples.map((e) => (
                    <li key={e.videoId}>
                      <a href={`https://www.youtube.com/watch?v=${e.videoId}`} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-2 rounded px-1 py-0.5 hover:bg-muted">
                        <span className="min-w-0 truncate">{e.title}</span>
                        <span className={`shrink-0 tabular-nums ${e.score >= 1 ? 'text-phase-2-ink' : 'text-destructive'}`}>×{e.score.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
