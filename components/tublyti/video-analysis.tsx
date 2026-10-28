'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, ExternalLink, Loader2, RotateCw, Sparkles, X } from 'lucide-react';
import { readVideoAnalysis, runVideoAnalysis } from '@/lib/actions/video-analysis';
import type { StoredAnalysis, VideoAnalysis } from '@/lib/video/analyze';
import { analysisToMarkdown } from '@/lib/video/analyze-markdown';

const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(Math.round(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

const STEPS = ['Gemini regarde la vidéo…', 'Écoute de la voix et de la musique…', 'Lecture du texte à l’écran…', 'Découpage en parties…', 'Rédaction de l’analyse…'];

interface Props {
  videoId: string;
  title?: string;
  /** Ligne user_channels quand la vidéo est à l'utilisateur (ajoute la lecture des décrochages). */
  channelId?: string;
  /** Apparence du déclencheur. */
  variant?: 'button' | 'link' | 'icon';
  label?: string;
}

/** Bouton « Analyser » + panneau latéral avec l'analyse du contenu (image, audio, texte). */
export function AnalyzeVideoButton({ videoId, title, channelId, variant = 'button', label = 'Analyser' }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Analyser l’image, l’audio et le texte de cette vidéo"
        aria-label={variant === 'icon' ? `Analyser la vidéo ${title ?? ''}` : undefined}
        className={
          variant === 'icon'
            ? 'flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-primary'
            : variant === 'link'
              ? 'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-primary hover:bg-muted'
              : 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-soft px-2.5 text-[13px] font-medium text-primary-ink transition-colors hover:bg-primary-soft/70'
        }
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {variant !== 'icon' && label}
      </button>
      {open && <AnalysisDrawer videoId={videoId} title={title} channelId={channelId} onClose={() => setOpen(false)} />}
    </>
  );
}

function AnalysisDrawer({ videoId, title, channelId, onClose }: { videoId: string; title?: string; channelId?: string; onClose: () => void }) {
  const [row, setRow] = useState<StoredAnalysis | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, start] = useTransition();
  const [step, setStep] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    readVideoAnalysis(videoId).then((r) => {
      if (!alive) return;
      setEnabled(r.enabled);
      setRow(r.row);
      setLoaded(true);
    });
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      alive = false;
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [videoId, onClose]);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setStep((s) => (s + 1) % STEPS.length), 6000);
    return () => window.clearInterval(t);
  }, [running]);

  function launch() {
    setError(null);
    setStep(0);
    start(async () => {
      const res = await runVideoAnalysis(videoId, { channelId });
      if (res.ok) setRow(res.row);
      else setError(res.message);
    });
  }

  const done = row?.status === 'done' && row.analysis;
  const shownTitle = row?.title ?? title ?? 'Vidéo';

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true" aria-label={`Analyse de ${shownTitle}`}>
      <button type="button" aria-label="Fermer" onClick={onClose} className="absolute inset-0 bg-black/20 backdrop-blur-[2px] animate-in fade-in-0" />
      <div className="elev-3 relative flex h-full w-full max-w-[720px] flex-col overflow-hidden bg-background animate-in slide-in-from-right-8 duration-200 sm:m-2 sm:h-[calc(100%-16px)] sm:rounded-[22px]">
        {/* En-tête */}
        <header className="flex items-start gap-3 border-b border-border bg-card/80 px-5 py-4 backdrop-blur-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" className="elev-1 aspect-video w-[112px] shrink-0 rounded-lg object-cover" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-primary-ink">
              <Sparkles className="h-3 w-3" aria-hidden="true" /> Analyse de la vidéo
            </span>
            <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug">{shownTitle}</h2>
            <span className="text-[12px] text-muted-foreground">
              {[row?.channelTitle, row?.durationS ? clock(row.durationS) : null].filter(Boolean).join(' · ')}
              {' · '}
              <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:underline">
                YouTube <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </span>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fermer" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {!loaded ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Chargement…
            </p>
          ) : running ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center" role="status" aria-live="polite">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft">
                <Loader2 className="h-6 w-6 animate-spin text-primary-ink" aria-hidden="true" />
              </span>
              <p className="text-[15px] font-medium">{STEPS[step]}</p>
              <p className="max-w-sm text-[13px] text-muted-foreground">Compte 30 secondes à 2 minutes selon la durée de la vidéo. Tu peux laisser ce panneau ouvert.</p>
            </div>
          ) : done ? (
            <AnalysisView row={row} onRerun={channelId ? launch : undefined} />
          ) : (
            <Intro enabled={enabled} error={error ?? (row?.status === 'error' ? 'La dernière analyse a échoué.' : null)} mine={Boolean(channelId)} onLaunch={launch} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Intro({ enabled, error, mine, onLaunch }: { enabled: boolean; error: string | null; mine: boolean; onLaunch: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft">
        <Sparkles className="h-6 w-6 text-primary-ink" aria-hidden="true" />
      </span>
      <h3 className="text-[19px] font-semibold tracking-[-0.01em]">Comprendre comment cette vidéo est faite</h3>
      <p className="text-[14px] leading-relaxed text-muted-foreground">
        L’IA regarde les images, écoute la voix et la musique, lit le texte à l’écran. Tu obtiens l’accroche, la structure minute par minute, le style de montage, la transcription,
        {mine ? ' ce qui se passe à chaque décrochage de ta rétention,' : ''} et ce que tu peux reprendre pour ta chaîne.
      </p>
      {error && <p role="alert" className="w-full rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{error}</p>}
      {enabled ? (
        <button type="button" onClick={onLaunch} className="elev-1 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:opacity-90">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> {error ? 'Réessayer' : 'Lancer l’analyse'}
        </button>
      ) : (
        <p className="rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">
          L’analyse vidéo n’est pas encore activée. Ajoute la clé <code>GEMINI_API_KEY</code> (gratuite sur Google AI Studio) dans les variables du site.
        </p>
      )}
      <p className="text-[12px] text-muted-foreground">Vidéos publiques uniquement · une analyse est gardée et resservie sans nouveau coût.</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Stamp({ id, s }: { id: string; s: number }) {
  return (
    <a
      href={`https://www.youtube.com/watch?v=${id}&t=${s}s`}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12px] tabular-nums text-primary-ink hover:bg-primary-soft"
      title="Ouvrir la vidéo à ce moment"
    >
      {clock(s)}
    </a>
  );
}

function Bullets({ items, tone = 'default' }: { items: string[]; tone?: 'default' | 'good' | 'bad' | 'do' }) {
  const dot = tone === 'good' ? 'bg-phase-2' : tone === 'bad' ? 'bg-warning' : tone === 'do' ? 'bg-primary' : 'bg-muted-foreground';
  return (
    <ul className="flex flex-col gap-2">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed">
          <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          {x}
        </li>
      ))}
    </ul>
  );
}

function AnalysisView({ row, onRerun }: { row: StoredAnalysis; onRerun?: () => void }) {
  const a = row.analysis as VideoAnalysis;
  const id = row.videoId;
  const [copied, setCopied] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(analysisToMarkdown(row));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const facts: [string, string][] = (
    [
      ['Style', a.format.style],
      ['Voix', [a.format.voice, a.format.voice_tone].filter(Boolean).join(' — ')],
      ['Musique', a.format.music],
      ['Texte à l’écran', a.format.on_screen_text],
      ['Rythme', [a.format.pacing, a.format.cuts_per_minute ? `~${a.format.cuts_per_minute} coupes/min` : ''].filter(Boolean).join(' · ')],
      ['Public', a.audience],
    ] as [string, string][]
  ).filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <p className="text-[15px] leading-relaxed">{a.summary}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={copy} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted px-2.5 text-[13px] font-medium hover:bg-muted/70">
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copied ? 'Copié' : 'Copier l’analyse'}
          </button>
          {onRerun && a.retention_notes.length === 0 && (
            <button type="button" onClick={onRerun} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted px-2.5 text-[13px] font-medium hover:bg-muted/70">
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Relancer avec ma rétention
            </button>
          )}
          <span className="text-[12px] text-muted-foreground">
            Analysée le {new Date(row.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
          </span>
        </div>
      </div>

      <Section title="L’accroche">
        <div className="elev-1 flex flex-col gap-3 rounded-2xl bg-card p-4">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Stamp id={id} s={a.hook.start_s} /> → <Stamp id={id} s={a.hook.end_s} />
            {a.hook.technique && <span className="ml-1 rounded-md bg-primary-soft px-1.5 py-0.5 text-[12px] font-medium text-primary-ink">{a.hook.technique}</span>}
          </div>
          {a.hook.said && <blockquote className="border-l-2 border-primary pl-3 text-[14px] italic leading-relaxed">« {a.hook.said} »</blockquote>}
          <dl className="grid gap-2 text-[14px] sm:grid-cols-2">
            {a.hook.shown && (
              <div>
                <dt className="text-[12px] text-muted-foreground">À l’image</dt>
                <dd>{a.hook.shown}</dd>
              </div>
            )}
            {a.hook.promise && (
              <div>
                <dt className="text-[12px] text-muted-foreground">Promesse faite</dt>
                <dd>{a.hook.promise}</dd>
              </div>
            )}
          </dl>
        </div>
      </Section>

      {a.retention_notes.length > 0 && (
        <Section title="Ce qui se passe à tes décrochages">
          <ul className="flex flex-col gap-2">
            {a.retention_notes.map((n, i) => (
              <li key={i} className="flex flex-col gap-1.5 rounded-2xl bg-warning/10 p-3.5">
                <span className="flex items-center gap-2 text-[13px]">
                  <Stamp id={id} s={n.at_s} />
                  {n.drop && <span className="font-semibold text-warning">{n.drop}</span>}
                </span>
                <p className="text-[14px] leading-relaxed">{n.what_happens}</p>
                {n.fix && <p className="text-[14px] leading-relaxed"><span className="font-medium">À corriger : </span>{n.fix}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="La forme">
        <dl className="grid gap-2 sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-card px-3 py-2.5">
              <dt className="text-[12px] text-muted-foreground">{k}</dt>
              <dd className="text-[14px] leading-snug">{v}</dd>
            </div>
          ))}
        </dl>
        {a.format.visuals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {a.format.visuals.map((v) => (
              <span key={v} className="rounded-full bg-muted px-2.5 py-1 text-[12px]">{v}</span>
            ))}
          </div>
        )}
      </Section>

      {a.chapters.length > 0 && (
        <Section title="La structure">
          <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
            {a.chapters.map((c, i) => (
              <li key={i} className="relative flex flex-col gap-1">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" aria-hidden="true" />
                <span className="flex items-center gap-2">
                  <Stamp id={id} s={c.start_s} />
                  <span className="text-[14px] font-medium">{c.title}</span>
                </span>
                {c.summary && <p className="text-[13px] leading-relaxed text-muted-foreground">{c.summary}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {a.retention_devices.length > 0 && (
        <Section title="Les relances d’attention">
          <ul className="flex flex-col gap-2">
            {a.retention_devices.map((d, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[14px] leading-relaxed">
                <Stamp id={id} s={d.at_s} />
                <span>
                  <span className="font-medium">{d.technique}</span>
                  {d.description && <span className="text-muted-foreground"> — {d.description}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(a.packaging.title_promise || a.cta.length > 0) && (
        <Section title="Titre, miniature et appels à l’action">
          {a.packaging.title_promise && (
            <p className="text-[14px] leading-relaxed">
              <span className="font-medium">Promesse : </span>
              {a.packaging.title_promise}
              {a.packaging.delivered && <span className="text-muted-foreground"> — {a.packaging.delivered}</span>}
            </p>
          )}
          {a.cta.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {a.cta.map((c, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[14px]">
                  <Stamp id={id} s={c.at_s} /> {c.text}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {a.why_it_works.length > 0 && (
          <Section title="Pourquoi ça marche">
            <Bullets items={a.why_it_works} tone="good" />
          </Section>
        )}
        {a.weaknesses.length > 0 && (
          <Section title="Points faibles">
            <Bullets items={a.weaknesses} tone="bad" />
          </Section>
        )}
      </div>

      {a.how_to_adapt.length > 0 && (
        <Section title="À reprendre pour ta chaîne">
          <div className="rounded-2xl bg-primary-soft/60 p-4">
            <Bullets items={a.how_to_adapt} tone="do" />
          </div>
        </Section>
      )}

      {a.transcript.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setShowTranscript((s) => !s)}
            aria-expanded={showTranscript}
            className="flex items-center gap-1.5 text-left text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground hover:text-foreground"
          >
            Transcription {a.transcript_partial && <span className="normal-case tracking-normal">(début et passages clés)</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTranscript ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {showTranscript && (
            <ol className="flex flex-col gap-2 rounded-2xl bg-card p-4">
              {a.transcript.map((t, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[14px] leading-relaxed">
                  <Stamp id={id} s={t.at_s} />
                  <span>{t.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
