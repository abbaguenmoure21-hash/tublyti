'use client';

import { useRef, useState, useTransition } from 'react';
import { AlertTriangle, Check, Film, ImagePlus, Loader2, Plus, Sparkles, TrendingDown, TrendingUp, Trophy, X } from 'lucide-react';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { evaluateBeforePublish, startVideoUpload, videoUploadState } from '@/lib/actions/preflight';
import type { PreflightResult } from '@/lib/preflight/engine';
import type { TitleScore } from '@/lib/preflight/titles';
import { HOOK_TYPES } from '@/lib/preflight/hook-types';
import { scrollBehavior } from '@/lib/scroll';

const nf = new Intl.NumberFormat('fr-FR');
const pct = (x: number) => `${Math.round(x * 100)} %`;
const times = (m: number) => `×${m.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;

/** Réduit l'image côté navigateur (1280 px de large, JPEG) pour un envoi léger. */
async function shrink(file: File): Promise<{ mimeType: string; base64: string; tinyBase64: string; preview: string }> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const scale = Math.min(1, 1280 / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  // Copie à ~18 % de la taille (fil d'actualité sur téléphone) pour le test « se comprend en tout petit ».
  const tiny = document.createElement('canvas');
  tiny.width = Math.max(1, Math.round(canvas.width * 0.18));
  tiny.height = Math.max(1, Math.round(canvas.height * 0.18));
  tiny.getContext('2d')?.drawImage(canvas, 0, 0, tiny.width, tiny.height);
  return { mimeType: 'image/jpeg', base64: dataUrl.split(',')[1], tinyBase64: tiny.toDataURL('image/jpeg', 0.9).split(',')[1], preview: dataUrl };
}

function tone(score: number) {
  return score >= 75 ? 'text-phase-2-ink bg-phase-2-soft' : score >= 55 ? 'text-phase-1-ink bg-phase-1-soft' : 'text-destructive bg-destructive/10';
}

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
      <div className={`h-full rounded-full ${value >= 75 ? 'bg-phase-2' : value >= 55 ? 'bg-warning' : 'bg-destructive'}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function PreflightForm({ userChannelId, aiEnabled }: { userChannelId: string; aiEnabled: boolean }) {
  const [titles, setTitles] = useState<string[]>(['']);
  const [script, setScript] = useState('');
  const [thumb, setThumb] = useState<{ mimeType: string; base64: string; tinyBase64: string; preview: string } | null>(null);
  const [video, setVideo] = useState<UploadState | null>(null);
  const [publishAt, setPublishAt] = useState(() => {
    const d = new Date(Date.now() + 86_400_000);
    d.setMinutes(0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (!/^image\//.test(f.type)) return setError('Choisis une image (JPG, PNG ou WebP).');
    setError(null);
    setThumb(await shrink(f));
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await evaluateBeforePublish({
        userChannelId,
        titles,
        script: script.trim() || undefined,
        thumbnail: thumb ? { mimeType: thumb.mimeType, base64: thumb.base64, tinyBase64: thumb.tinyBase64 } : null,
        video: video?.status === 'ready' && video.file ? { ...video.file, durationS: video.durationS } : null,
        publishAt: publishAt ? new Date(publishAt).toISOString() : null,
      });
      if (video?.status === 'ready') setVideo(null); // le fichier est effacé chez Gemini après l'analyse
      if (!res.ok) return setError(res.message);
      setResult(res.result);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }), 50);
    });
  }

  const words = script.trim() ? script.trim().split(/\s+/).length : 0;

  return (
    <section aria-labelledby="pf-form" className="flex flex-col gap-6">
      <div className="elev-1 grid gap-6 rounded-[22px] bg-card p-5 md:grid-cols-[1fr_300px] md:p-6">
        <div className="flex flex-col gap-5">
          <h2 id="pf-form" className="text-lg font-semibold">Ta prochaine vidéo</h2>

          <div className="flex flex-col gap-2">
            <label htmlFor="pf-title-0" className="text-[13px] font-medium">Titre{titles.length > 1 ? 's à comparer' : ''}</label>
            {titles.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  id={i === 0 ? 'pf-title-0' : undefined}
                  aria-label={i === 0 ? undefined : `Variante ${i + 1}`}
                  value={t}
                  onChange={(e) => setTitles((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder={i === 0 ? 'Ex. : Why Nobody Talks About the Richest Village in Africa' : `Variante ${i + 1}`}
                  maxLength={150}
                  className="h-11 w-full rounded-[10px] border border-input bg-background px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="w-9 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{t.length}</span>
                {titles.length > 1 && (
                  <button type="button" onClick={() => setTitles((xs) => xs.filter((_, j) => j !== i))} aria-label="Retirer cette variante" className="relative flex h-8 w-8 after:absolute after:-inset-1.5 md:after:hidden items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            {titles.length < 3 && (
              <button type="button" onClick={() => setTitles((xs) => [...xs, ''])} className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-primary">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Comparer une variante de titre
              </button>
            )}
          </div>

          <label className="flex flex-col gap-2">
            <span className="flex items-baseline justify-between text-[13px] font-medium">
              Script <span className="font-normal text-muted-foreground">facultatif · {words ? `${nf.format(words)} mots ≈ ${Math.max(1, Math.round(words / 150))} min` : 'au moins l’accroche'}</span>
            </span>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={7}
              placeholder="Colle ton script, ou au moins les 30 premières secondes (l’accroche compte double)."
              className="rounded-[10px] border border-input bg-background px-3 py-2.5 text-[14px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <VideoUploader state={video} onChange={setVideo} aiEnabled={aiEnabled} />

          <label className="flex flex-col gap-2 sm:max-w-xs">
            <span className="text-[13px] font-medium">Publication prévue <span className="font-normal text-muted-foreground">jour et heure comptent</span></span>
            <input
              type="datetime-local"
              value={publishAt}
              onChange={(e) => setPublishAt(e.target.value)}
              className="h-10 rounded-[10px] border border-input bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">Miniature <span className="font-normal text-muted-foreground">facultatif</span></span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
            className="well relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[14px] border border-dashed border-border bg-muted/50 text-[13px] text-muted-foreground hover:bg-muted"
          >
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb.preview} alt="Miniature choisie" className="h-full w-full object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-1.5">
                <ImagePlus className="h-6 w-6" aria-hidden="true" />
                Dépose ou choisis l’image
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          {thumb && (
            <button type="button" onClick={() => setThumb(null)} className="self-start text-[13px] font-medium text-primary">
              Retirer la miniature
            </button>
          )}
          {thumb && (
            <p className="text-[12px] text-muted-foreground">Aperçu en petit, comme sur mobile :</p>
          )}
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb.preview} alt="" className="aspect-video w-[168px] rounded-md object-cover" />
          )}
          {!aiEnabled && <p className="text-[12px] text-muted-foreground">Miniature et script seront notés une fois la clé Gemini ajoutée.</p>}
        </div>

        <div className="flex flex-col gap-3 md:col-span-2 md:flex-row md:items-center">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !titles.some((t) => t.trim()) || video?.status === 'uploading' || video?.status === 'processing'}
            className="elev-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {pending ? (video?.status === 'ready' ? 'Évaluation en cours… (1 à 3 min avec la vidéo)' : 'Évaluation en cours… (15 à 40 s)') : video?.status === 'uploading' || video?.status === 'processing' ? 'Attends la fin de l’envoi de la vidéo…' : 'Évaluer avant de publier'}
          </button>
          {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
        </div>
      </div>

      {result && (
        <div ref={resultRef}>
          <ResultView r={result} />
        </div>
      )}
    </section>
  );
}

function ResultView({ r }: { r: PreflightResult }) {
  const p = r.prediction;
  const verdict = r.verdict === 'ready' ? 'Prête à publier' : r.verdict === 'improve' ? 'À améliorer avant de publier' : 'À retravailler';
  return (
    <div className="flex flex-col gap-6" aria-live="polite">
      {/* Synthèse */}
      <div className="elev-1 grid gap-5 rounded-[22px] bg-card p-5 md:grid-cols-[180px_1fr] md:p-6">
        <div className="flex flex-col items-start gap-1">
          <span className="text-[13px] text-muted-foreground">Note globale</span>
          <span className="text-[56px] font-semibold leading-none tabular-nums tracking-[-0.03em]">{r.overall}</span>
          <span className={`mt-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tone(r.overall)}`}>{verdict}</span>
        </div>
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-background px-3 py-2.5">
              <dt className="text-[12px] text-muted-foreground">Vues attendues</dt>
              <dd className="text-[20px] font-semibold tabular-nums">{times(p.multiple)}</dd>
              <dd className="text-[12px] text-muted-foreground">{p.expectedViews ? `≈ ${nf.format(p.expectedViews)} vues` : 'tes vues habituelles'}</dd>
            </div>
            <div className="rounded-xl bg-background px-3 py-2.5">
              <dt className="text-[12px] text-muted-foreground">Chances de faire ×2</dt>
              <dd className="text-[20px] font-semibold tabular-nums">{pct(p.p2x)}</dd>
              <dd className="text-[12px] text-muted-foreground">niche : {pct(r.nichePrior.p2x)}</dd>
            </div>
            <div className="rounded-xl bg-background px-3 py-2.5">
              <dt className="text-[12px] text-muted-foreground">Chances de faire ×10</dt>
              <dd className="text-[20px] font-semibold tabular-nums">{pct(p.p10x)}</dd>
              <dd className="text-[12px] text-muted-foreground">niche : {pct(r.nichePrior.p10x)}</dd>
            </div>
          </dl>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {p.basis}{' '}
            {p.calibration.n >= 3
              ? `Recalée sur tes ${p.calibration.n} vidéos déjà mesurées (facteur ${times(p.calibration.factor)}).`
              : 'Elle se recalera sur tes résultats dès 3 vidéos publiées et mesurées.'}{' '}
            C’est une probabilité, pas une garantie.
          </p>
          {r.errors.map((e) => (
            <p key={e} className="flex items-start gap-2 text-[13px] text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {e}
            </p>
          ))}
        </div>
      </div>

      {r.model && <ModelSection r={r} />}

      {r.video && <VideoSection v={r.video} />}

      {/* Titres */}
      <section className="flex flex-col gap-3">
        <h3 className="text-[15px] font-semibold">Titre{r.titles.length > 1 ? 's' : ''}</h3>
        {r.titles.map((t) => (
          <TitleCard key={t.title} t={t} best={r.titles.length > 1 && t.title === r.bestTitle} />
        ))}
      </section>

      {/* Miniature */}
      {r.thumbnail && (
        <section className="elev-1 flex flex-col gap-4 rounded-[22px] bg-card p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold">Miniature</h3>
            <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums ${tone(r.thumbnail.score)}`}>{r.thumbnail.score}/100</span>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {r.thumbnail.compared_with ? `Comparée à ${r.thumbnail.compared_with} miniatures qui ont sur-performé dans ta niche.` : 'Comparée aux bonnes pratiques YouTube (pas encore de miniatures gagnantes dans ta niche).'}
          </p>
          <p className="text-[13px] leading-relaxed">
            <span className="font-medium">Ressort : </span>{CATEGORY[r.thumbnail.category]}
            {r.thumbnail.suggestedCategory !== r.thumbnail.category && r.thumbnail.suggestedCategory !== 'other' ? <> · <span className="font-medium">mieux pour ce titre : </span>{CATEGORY[r.thumbnail.suggestedCategory]}</> : null}
            {r.thumbnail.elements ? ` · ${r.thumbnail.elements} élément${r.thumbnail.elements > 1 ? 's' : ''} à l’image${r.thumbnail.elements > 3 ? ' (trop : vise 3 maximum)' : ''}` : ''}
            {r.thumbnail.categoryNote && <span className="block text-muted-foreground">{r.thumbnail.categoryNote}</span>}
          </p>
          <Criteria items={r.thumbnail.criteria} />
          <TwoLists good={r.thumbnail.strengths} fix={r.thumbnail.fixes} />
        </section>
      )}

      {/* Script */}
      {r.script && (
        <section className="elev-1 flex flex-col gap-4 rounded-[22px] bg-card p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-semibold">Script</h3>
            <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums ${tone(r.script.score)}`}>{r.script.score}/100</span>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl bg-background p-4">
            <span className="flex items-center gap-2 text-[13px] font-medium">
              Accroche (30 premières secondes) <span className={`rounded-full px-2 text-[12px] font-semibold ${tone(r.script.hook.score)}`}>{r.script.hook.score}</span>
            </span>
            <p className="text-[14px] leading-relaxed">{r.script.hook.verdict}</p>
            {r.script.hook.type && r.script.hook.type !== 'other' && (
              <p className="text-[13px] text-muted-foreground">Type d’accroche : <span className="font-medium text-foreground">{HOOK_TYPES[r.script.hook.type] ?? r.script.hook.type}</span></p>
            )}
            {r.script.hook.rewrite && (
              <blockquote className="border-l-2 border-primary pl-3 text-[14px] italic leading-relaxed">{r.script.hook.rewrite}</blockquote>
            )}
            {r.script.hook.alternatives?.length > 0 && (
              <div className="flex flex-col gap-1.5 pt-1">
                <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Autres accroches à essayer</span>
                {r.script.hook.alternatives.map((a) => (
                  <p key={a.line} className="text-[14px] leading-relaxed">
                    <span className="mr-1.5 rounded-md bg-primary-soft px-1.5 py-0.5 text-[12px] font-medium text-primary-ink">{HOOK_TYPES[a.type] ?? a.type}</span>
                    {a.line}
                  </p>
                ))}
              </div>
            )}
          </div>
          <Criteria items={r.script.criteria} />
          {r.script.risks.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-medium">Passages où les spectateurs risquent de partir</span>
              <ul className="flex flex-col gap-2">
                {r.script.risks.map((k, i) => (
                  <li key={i} className="flex gap-3 rounded-xl bg-warning/10 px-3 py-2.5 text-[14px]">
                    <span className="shrink-0 font-semibold tabular-nums text-warning">{k.at_pct} %</span>
                    <span>
                      {k.issue} <span className="text-muted-foreground">→ {k.fix}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <TwoLists good={r.script.strengths} fix={r.script.fixes} />
        </section>
      )}
    </div>
  );
}

function TitleCard({ t, best }: { t: TitleScore; best: boolean }) {
  return (
    <div className="elev-1 flex flex-col gap-4 rounded-[22px] bg-card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-[16px] font-medium leading-snug">
          {best && (
            <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 align-middle text-[12px] font-semibold text-primary-ink">
              <Trophy className="h-3 w-3" aria-hidden="true" /> Meilleur titre
            </span>
          )}
          {t.title}
        </p>
        <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums ${tone(t.score)}`}>{t.score}/100</span>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        <div><dt className="inline text-muted-foreground">Titres proches dans la niche : </dt><dd className="inline font-medium tabular-nums">{t.multiple === null ? '—' : times(t.multiple)}</dd></div>
        <div><dt className="inline text-muted-foreground">×2 : </dt><dd className="inline font-medium tabular-nums">{t.p2x === null ? '—' : pct(t.p2x)}</dd></div>
        <div><dt className="inline text-muted-foreground">Forme : </dt><dd className="inline font-medium tabular-nums">{t.formScore}/100</dd></div>
      </dl>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {t.checks.map((c) => (
          <li key={c.label} className="flex items-start gap-2 text-[13px]">
            {c.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-phase-2" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />}
            <span className={c.ok ? 'text-muted-foreground' : ''}>{c.label}</span>
          </li>
        ))}
      </ul>
      {(t.winners.length > 0 || t.losers.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {t.winners.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Proches et gagnants · inspire-toi</span>
              {t.winners.map((w) => (
                <a key={w.videoId} href={`https://www.youtube.com/watch?v=${w.videoId}`} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-muted">
                  <span className="min-w-0">
                    {w.title}
                    <span className="block text-[12px] text-muted-foreground">{w.channelTitle}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-phase-2-ink">{times(w.score)}</span>
                </a>
              ))}
            </div>
          )}
          {t.losers.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Proches mais ratés · évite</span>
              {t.losers.map((w) => (
                <a key={w.videoId} href={`https://www.youtube.com/watch?v=${w.videoId}`} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-muted">
                  <span className="min-w-0">
                    {w.title}
                    <span className="block text-[12px] text-muted-foreground">{w.channelTitle}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-destructive">{times(w.score)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Criteria({ items }: { items: { key: string; label: string; score: number; note: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((c) => (
        <li key={c.key} className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between text-[13px]">
            <span className="font-medium">{c.label}</span>
            <span className="tabular-nums text-muted-foreground">{c.score}</span>
          </span>
          <Bar value={c.score} />
          {c.note && <span className="text-[12px] leading-snug text-muted-foreground">{c.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function TwoLists({ good, fix }: { good: string[]; fix: string[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {good.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">Ce qui marche</span>
          <ul className="flex flex-col gap-1.5">
            {good.map((g) => (
              <li key={g} className="flex items-start gap-2 text-[14px]"><Check className="mt-1 h-3.5 w-3.5 shrink-0 text-phase-2" aria-hidden="true" />{g}</li>
            ))}
          </ul>
        </div>
      )}
      {fix.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl bg-primary-soft/60 p-3.5">
          <span className="text-[13px] font-medium">À changer avant de publier</span>
          <ul className="flex flex-col gap-1.5">
            {fix.map((g) => (
              <li key={g} className="flex items-start gap-2 text-[14px]"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />{g}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Vidéo finie : envoi direct navigateur → Gemini ───────────────────

type UploadState = {
  status: 'uploading' | 'processing' | 'ready' | 'error';
  fileName: string;
  size: number;
  progress: number;
  durationS: number | null;
  file?: { name: string; uri: string; mimeType: string };
  error?: string;
  startedAt: number;
  /** Temps restant estimé (secondes). */
  etaS?: number | null;
};

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v.duration) ? Math.round(v.duration) : null);
    };
    v.onerror = () => resolve(null);
    v.src = url;
  });
}

const mb = (b: number) => `${(b / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Mo`;

function VideoUploader({ state, onChange, aiEnabled }: { state: UploadState | null; onChange: (s: UploadState | null) => void; aiEnabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    const base: UploadState = { status: 'uploading', fileName: file.name, size: file.size, progress: 0, durationS: null, startedAt: Date.now() };
    onChange(base);
    const durationS = await readDuration(file);
    const start = await startVideoUpload({ size: file.size, mimeType: file.type || 'video/mp4', name: file.name });
    if (!start.ok) return onChange({ ...base, durationS, status: 'error', error: start.message });

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', start.uploadUrl);
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
    let last = 0;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || Date.now() - last < 400) return;
      last = Date.now();
      const p = e.loaded / e.total;
      const elapsed = (Date.now() - base.startedAt) / 1000;
      onChange({ ...base, durationS, progress: p, etaS: p > 0.02 ? Math.round((elapsed / p) * (1 - p)) : null });
    };
    xhr.onerror = () =>
      onChange({ ...base, durationS, status: 'error', error: 'L’envoi a été interrompu (connexion coupée ou bloquée). Réessaie, idéalement avec une version allégée (720p).' });
    xhr.onload = async () => {
      let f: { name?: string; uri?: string; mimeType?: string } = {};
      try {
        f = (JSON.parse(xhr.responseText) as { file?: typeof f }).file ?? {};
      } catch {
        /* réponse illisible */
      }
      if (xhr.status >= 300 || !f.name) return onChange({ ...base, durationS, status: 'error', error: `Envoi refusé (${xhr.status}).` });
      onChange({ ...base, durationS, progress: 1, status: 'processing' });
      // Gemini prépare la vidéo (souvent 10 s à 2 min).
      for (let i = 0; i < 90; i++) {
        const st = await videoUploadState(f.name);
        if (st.state === 'ACTIVE' && st.uri) {
          return onChange({ ...base, durationS, progress: 1, status: 'ready', file: { name: f.name, uri: st.uri, mimeType: st.mimeType ?? f.mimeType ?? 'video/mp4' } });
        }
        if (st.state === 'FAILED') return onChange({ ...base, durationS, status: 'error', error: st.error ?? 'Gemini n’a pas pu lire la vidéo.' });
        await new Promise((r) => setTimeout(r, 4000));
      }
      onChange({ ...base, durationS, status: 'error', error: 'La préparation de la vidéo prend trop de temps. Réessaie.' });
    };
    xhr.send(file);
  }

  function cancel() {
    xhrRef.current?.abort();
    onChange(null);
  }

  const eta = state?.status === 'uploading' ? state.etaS ?? null : null;

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-baseline justify-between text-[13px] font-medium">
        Vidéo finie <span className="font-normal text-muted-foreground">facultatif · montage, son, rétention prévue</span>
      </span>
      {!state ? (
        <button
          type="button"
          disabled={!aiEnabled}
          onClick={() => ref.current?.click()}
          className="well flex items-center gap-3 rounded-[12px] border border-dashed border-border bg-muted/50 px-4 py-3.5 text-left text-[13px] text-muted-foreground hover:bg-muted disabled:opacity-60"
        >
          <Film className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>
            <span className="block font-medium text-foreground">Choisis ta vidéo (MP4, MOV, WebM, 2 Go max)</span>
            Exporte de préférence une version légère en 720p : l’analyse est aussi bonne et l’envoi bien plus rapide. La vidéo est effacée après l’analyse.
          </span>
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-[12px] bg-muted/50 px-4 py-3">
          <div className="flex items-center gap-3 text-[13px]">
            <Film className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{state.fileName}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{mb(state.size)}</span>
            <button type="button" onClick={cancel} aria-label="Retirer la vidéo" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-card">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {state.status === 'uploading' && (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-card" role="progressbar" aria-valuenow={Math.round(state.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Envoi de la vidéo">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(state.progress * 100)}%` }} />
              </div>
              <span className="text-[12px] text-muted-foreground">
                Envoi… {Math.round(state.progress * 100)} %{eta !== null ? ` · encore ~${eta > 90 ? `${Math.round(eta / 60)} min` : `${eta} s`}` : ''}. Garde cette page ouverte.
              </span>
            </>
          )}
          {state.status === 'processing' && (
            <span className="flex items-center gap-2 text-[12px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Gemini prépare la vidéo…</span>
          )}
          {state.status === 'ready' && (
            <span className="flex items-center gap-2 text-[12px] text-phase-2-ink"><Check className="h-3.5 w-3.5" aria-hidden="true" /> Prête à être analysée{state.durationS ? ` · ${Math.floor(state.durationS / 60)} min ${String(state.durationS % 60).padStart(2, '0')}` : ''}</span>
          )}
          {state.status === 'error' && <span className="text-[12px] text-destructive">{state.error}</span>}
        </div>
      )}
      <input ref={ref} type="file" accept="video/mp4,video/quicktime,video/webm,video/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function VideoSection({ v }: { v: NonNullable<PreflightResult['video']> }) {
  const data = v.retention.map((p) => ({ ...p, at_s: v.durationS ? Math.round((p.at_pct / 100) * v.durationS) : null }));
  return (
    <section className="elev-1 flex flex-col gap-4 rounded-[22px] bg-card p-5 md:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold">Vidéo : montage, son, rétention prévue</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold tabular-nums ${tone(v.score)}`}>{v.score}/100</span>
      </div>
      {data.length > 2 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-muted-foreground">Part des spectateurs encore là, d’après l’IA (estimation avant publication)</span>
          <div className="h-44 w-full" role="img" aria-label="Rétention prévue au fil de la vidéo">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="at_pct" tickFormatter={(x: number) => (v.durationS ? clock((x / 100) * v.durationS) : `${x} %`)} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 1]} tickFormatter={(x: number) => `${Math.round(x * 100)} %`} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} width={44} />
                <Tooltip formatter={(x) => [`${Math.round(Number(x) * 100)} %`, 'Encore là']} labelFormatter={(x) => (v.durationS ? `À ${clock((Number(x) / 100) * v.durationS)}` : `À ${x} %`)} />
                <Line type="monotone" dataKey="watch" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <Criteria items={v.criteria} />
      {(v.audio || v.cuts_per_minute) && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {v.audio}
          {v.cuts_per_minute ? ` · ~${v.cuts_per_minute} coupes par minute.` : ''}
        </p>
      )}
      {v.drops.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">Moments où les spectateurs risquent de partir</span>
          <ul className="flex flex-col gap-2">
            {v.drops.map((d, i) => (
              <li key={i} className="flex gap-3 rounded-xl bg-warning/10 px-3 py-2.5 text-[14px]">
                <span className="shrink-0 font-mono font-semibold tabular-nums text-warning">{clock(d.at_s)}</span>
                <span>
                  {d.issue} <span className="text-muted-foreground">→ {d.fix}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <TwoLists good={v.strengths} fix={v.fixes} />
    </section>
  );
}

const PHASES: Record<number, string> = { 1: 'émergent', 2: 'en croissance', 3: 'au pic', 4: 'en déclin' };

function ModelSection({ r }: { r: PreflightResult }) {
  const m = r.model!;
  const up = m.drivers.filter((d) => d.effect > 0.02);
  const down = m.drivers.filter((d) => d.effect < -0.02);
  const pctEffect = (e: number) => `${e > 0 ? '+' : '−'}${Math.round(Math.abs(Math.exp(e) - 1) * 100)} %`;
  return (
    <section className="elev-1 flex flex-col gap-4 rounded-[22px] bg-card p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Ce qui joue pour et contre cette vidéo</h3>
        <span className="text-[12px] text-muted-foreground">
          Modèle entraîné le {new Date(m.trainedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} sur {nf.format(m.n)} vidéos
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-[13px] font-medium"><TrendingUp className="h-4 w-4 text-phase-2" aria-hidden="true" /> Pour</span>
          {up.length ? up.map((d) => (
            <span key={d.label} className="flex justify-between gap-3 text-[14px]"><span>{d.label}</span><span className="tabular-nums text-phase-2-ink">{pctEffect(d.effect)}</span></span>
          )) : <span className="text-[13px] text-muted-foreground">Rien de marquant.</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-[13px] font-medium"><TrendingDown className="h-4 w-4 text-destructive" aria-hidden="true" /> Contre</span>
          {down.length ? down.map((d) => (
            <span key={d.label} className="flex justify-between gap-3 text-[14px]"><span>{d.label}</span><span className="tabular-nums text-destructive">{pctEffect(d.effect)}</span></span>
          )) : <span className="text-[13px] text-muted-foreground">Rien de marquant.</span>}
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        {m.topicPhase ? `Sujet le plus proche : ${PHASES[m.topicPhase] ?? 'phase inconnue'}, ${m.topicRecent7d} vidéo${m.topicRecent7d > 1 ? 's' : ''} concurrente${m.topicRecent7d > 1 ? 's' : ''} ces 7 derniers jours. ` : ''}
        Fiabilité mesurée sur les vidéos les plus récentes ({nf.format(m.metrics.testN)}) : le modèle explique {Math.max(0, Math.round(m.metrics.r2 * 100))} % des écarts de vues, et ses probabilités « ×2 » sont {m.metrics.brierP2x < m.metrics.baseBrierP2x ? `${Math.round((1 - m.metrics.brierP2x / m.metrics.baseBrierP2x) * 100)} % plus justes` : 'pas encore meilleures'} qu’une estimation au hasard.
      </p>
    </section>
  );
}

const CATEGORY: Record<string, string> = {
  transformation: 'transformation (montre le résultat)',
  mystery: 'mystère (tension, élément caché)',
  comparison: 'comparaison (deux choses face à face)',
  wealth: 'richesse (argent, prix, démesure)',
  other: 'autre',
};
