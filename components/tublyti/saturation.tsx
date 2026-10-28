'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Layers, Loader2, Search } from 'lucide-react';
import { checkLinkSaturation, checkOutlierSaturation } from '@/lib/actions/saturation';
import type { LinkSaturation, OutlierSaturation, SaturationLevel, TopicSaturation } from '@/lib/saturation';

// LEXIQUE.md: never "Saturé / Saturation". Phase colors are reserved to phases (DESIGN.md).
/** Labels for an idea (a video that can be copied). */
const LABEL: Record<SaturationLevel, string> = { open: 'Peu copiée', filling: 'Déjà bien copiée', saturated: 'Trop copiée', unknown: 'À confirmer' };
/** Labels for a topic (competition). */
const TOPIC_LABEL: Record<SaturationLevel, string> = { open: 'Peu de concurrence', filling: 'Concurrence en hausse', saturated: 'Trop de concurrence', unknown: 'À confirmer' };
const TONE: Record<SaturationLevel, string> = {
  open: 'bg-primary-soft text-primary-ink',
  filling: 'bg-muted text-foreground',
  saturated: 'bg-destructive/10 text-destructive',
  unknown: 'bg-muted text-muted-foreground',
};
const multipleTone = (score: number) => (score >= 1 ? 'text-foreground' : 'text-destructive');

/** Carte « Concurrence sur ce sujet » de la fiche sujet. */
export function TopicSaturationCard({ s }: { s: TopicSaturation }) {
  return (
    <section className="bento-card flex flex-col gap-3 !px-[18px] !py-4" aria-labelledby="sat-titre">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-semibold ${TONE[s.level]}`}>
          <Layers className="h-4 w-4" aria-hidden="true" /> {TOPIC_LABEL[s.level]}
        </span>
        <h2 id="sat-titre" className="text-[13px] font-semibold">Concurrence sur ce sujet{s.score !== null ? ` · ${s.score}/100` : ''}</h2>
        {s.score !== null && (
          <span className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span className={`block h-full rounded-full ${s.level === 'saturated' ? 'bg-destructive' : s.level === 'filling' ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${s.score}%` }} />
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
                        <span className={`shrink-0 tabular-nums ${multipleTone(e.score)}`}>×{e.score.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</span>
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

/** « Avant de publier » : colle n'importe quel lien YouTube pour savoir si l'idée a déjà été trop copiée. */
export function LinkSaturationCheck() {
  const [link, setLink] = useState('');
  const [res, setRes] = useState<LinkSaturation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setErr(null);
    start(async () => {
      const r = await checkLinkSaturation(link);
      if (r.ok) setRes(r.data);
      else {
        setRes(null);
        setErr(r.message);
      }
    });
  }

  const s = res?.result;
  return (
    <section aria-labelledby="sat-lien" className="flex flex-col gap-3">
      <div>
        <h2 id="sat-lien" className="text-lg font-semibold">Cette idée a-t-elle déjà été trop copiée ?</h2>
        <p className="text-[13px] text-muted-foreground">Colle le lien d’une vidéo qui t’inspire, de n’importe quelle chaîne : TubLyTI cherche dans sa niche les vidéos au titre très proche publiées avant et après, et regarde si elles marchent encore (×2 = deux fois les vues habituelles de leur chaîne).</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) run();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-label="Lien de la vidéo YouTube"
          className="h-11 flex-1 rounded-[10px] border border-input bg-background px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <button type="submit" disabled={pending || !link.trim()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          Vérifier
        </button>
      </form>
      {err && <p role="alert" className="text-[13px] text-destructive">{err}</p>}

      {res && s && (
        <div className="elev-1 flex flex-col gap-3 rounded-[22px] bg-card p-5">
          <div className="flex flex-wrap items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`https://i.ytimg.com/vi/${res.videoId}/mqdefault.jpg`} alt="" className="aspect-video w-[120px] shrink-0 rounded-lg object-cover" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <a href={`https://www.youtube.com/watch?v=${res.videoId}`} target="_blank" rel="noreferrer" className="text-[15px] font-medium leading-snug hover:underline">{res.title}</a>
              <span className="text-[12px] text-muted-foreground">
                {res.channelTitle} · {new Date(res.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                {res.nicheName ? ` · niche ${res.inCatalog ? '' : 'détectée '}: ${res.nicheName}` : ''}
              </span>
            </div>
            <span className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-semibold ${TONE[s.level]}`}>
              <Layers className="h-4 w-4" aria-hidden="true" /> {LABEL[s.level]}
            </span>
          </div>
          <p className="text-[14px] leading-relaxed">{s.verdict}</p>
          <p className="text-[12px] text-muted-foreground">
            {s.copies} vidéo{s.copies > 1 ? 's' : ''} très proche{s.copies > 1 ? 's' : ''} publiée{s.copies > 1 ? 's' : ''} après (dont {s.copiesLast30d} ces 30 derniers jours, {s.copyChannels} chaîne{s.copyChannels > 1 ? 's' : ''}) · {s.earlier} déjà publiée{s.earlier > 1 ? 's' : ''} avant elle.
          </p>
          {s.examples.length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-border pt-2 text-[13px]">
              {s.examples.map((e) => (
                <li key={e.videoId}>
                  <a href={`https://www.youtube.com/watch?v=${e.videoId}`} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 rounded px-1 py-1 hover:bg-muted">
                    <span className="min-w-0">
                      {e.title}
                      <span className="block text-[12px] text-muted-foreground">{e.channelTitle} · {new Date(e.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                    </span>
                    <span className={`shrink-0 font-semibold tabular-nums ${multipleTone(e.score)}`}>×{e.score.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
