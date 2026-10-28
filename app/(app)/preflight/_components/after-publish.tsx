'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { linkCheckToVideo } from '@/lib/actions/preflight';
import type { CheckRow, FollowRow } from '@/lib/preflight/engine';

const nf = new Intl.NumberFormat('fr-FR');
const times = (m: number) => `×${m.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;
const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

const STATUS: Record<FollowRow['status'], { label: string; cls: string }> = {
  above: { label: 'Au-dessus', cls: 'bg-primary-soft text-primary-ink' },
  normal: { label: 'Habituel', cls: 'bg-muted text-muted-foreground' },
  below: { label: 'En dessous', cls: 'bg-destructive/10 text-destructive' },
  unknown: { label: 'Trop tôt', cls: 'bg-muted text-muted-foreground' },
};

/** Suivi des vidéos des 21 derniers jours, comparées aux vues habituelles de la chaîne au même âge. */
export function FollowUp({ rows }: { rows: FollowRow[] }) {
  return (
    <section aria-labelledby="pf-suivi" className="flex flex-col gap-3">
      <div>
        <h2 id="pf-suivi" className="text-lg font-semibold">Suivi après publication</h2>
        <p className="text-[13px] text-muted-foreground">Tes vidéos des 21 derniers jours, comparées à tes vidéos précédentes au même âge. Les 72 premières heures décident souvent de la suite.</p>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-card px-4 py-6 text-center">
          <p className="text-[14px] text-muted-foreground">Aucune vidéo publiée ces 3 dernières semaines. Une vidéo publiée aujourd’hui apparaît ici dès demain.</p>
          <Link href="/preflight?vue=evaluer" scroll={false} className="inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:opacity-90">
            Évaluer ma prochaine vidéo
          </Link>
        </div>
      ) : (
        <ul className="elev-1 overflow-hidden rounded-[22px] bg-card">
          {rows.map((r) => (
            <li key={r.videoId} className="flex flex-col gap-2 border-b border-muted px-4 py-3.5 last:border-b-0 md:flex-row md:items-center md:gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`} alt="" className="hidden aspect-video w-[88px] shrink-0 rounded-md object-cover md:block" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <a href={`https://www.youtube.com/watch?v=${r.videoId}`} target="_blank" rel="noreferrer" className="truncate text-[14px] font-medium hover:underline">{r.title}</a>
                <span className="text-[12px] text-muted-foreground">
                  {r.ageDays < 1 ? `${Math.round(r.ageDays * 24)} h` : `${r.ageDays.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`} · {nf.format(r.views)} vues
                  {r.baseline ? ` · habituel à cet âge : ${nf.format(Math.round(r.baseline))}` : ''}
                  {r.ctr !== null ? ` · taux de clic ${(r.ctr * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : ''}
                </span>
                <span className="text-[13px] leading-snug">{r.advice}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.multiple !== null && (
                  <span className="text-[15px] font-semibold tabular-nums" title="Par rapport à tes vidéos précédentes au même âge">
                    {times(r.multiple)}
                    <span className="sr-only"> par rapport à tes vidéos précédentes au même âge</span>
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Prédictions passées et résultats réels à 7 jours : c'est ce qui recale le modèle sur la chaîne. */
export function History({
  checks,
  linkable,
  calibration,
}: {
  checks: CheckRow[];
  linkable: { id: string; title: string }[];
  calibration: { factor: number; n: number; hits: { predictedHigh: number; actualHigh: number } | null };
}) {
  const [pending, start] = useTransition();
  // Every change can be undone from its toast (ERGONOMIE: nothing is final without a way back).
  const setLink = (id: string, videoId: string | null, previous: string | null, isUndo = false) =>
    start(async () => {
      const r = await linkCheckToVideo(id, videoId);
      if (!r.ok) return void toast.error(r.message ?? 'Échec');
      if (isUndo) return void toast('Modification annulée');
      toast(videoId ? 'Évaluation rattachée' : 'Rattachement retiré', {
        description: videoId ? 'Le résultat sera mesuré 7 jours après la publication.' : 'Choisis la bonne vidéo dans la liste.',
        action: { label: 'Annuler', onClick: () => setLink(id, previous, videoId, true) },
      });
    });
  const link = (id: string, videoId: string) => setLink(id, videoId, null);
  const unlink = (c: CheckRow) => setLink(c.id, null, c.videoId);

  const actual = (c: CheckRow) =>
    c.actualMultiple !== null ? (
      <span className={c.actualMultiple >= (c.predictedMultiple ?? 1) ? 'font-semibold text-primary-ink' : 'font-semibold'}>{times(c.actualMultiple)}</span>
    ) : c.pendingDays !== null ? (
      <span className="text-muted-foreground">dans {c.pendingDays} j</span>
    ) : (
      '—'
    );
  const published = (c: CheckRow) =>
    c.videoId ? (
      <span className="flex min-w-0 items-center gap-2">
        <a href={`https://www.youtube.com/watch?v=${c.videoId}`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-primary hover:underline">{c.videoTitle ?? c.videoId}</a>
        <button type="button" disabled={pending} onClick={() => unlink(c)} className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
          Changer
        </button>
      </span>
    ) : (
      <LinkPicker disabled={pending || !linkable.length} linkable={linkable} onLink={(videoId) => link(c.id, videoId)} />
    );

  return (
    <section aria-labelledby="pf-hist" className="flex flex-col gap-3">
      <div>
        <h2 id="pf-hist" className="text-lg font-semibold">Mes prédictions et leurs résultats</h2>
        <p className="text-[13px] text-muted-foreground">
          Chaque évaluation est rattachée à la vidéo publiée (automatiquement si le titre est proche), puis mesurée à 7 jours.
          {calibration.n >= 3
            ? ` Sur tes ${calibration.n} vidéos mesurées, tes résultats valent en moyenne ${times(calibration.factor)} la prédiction : les prochaines en tiennent compte.`
            : ` Encore ${3 - calibration.n} vidéo${3 - calibration.n > 1 ? 's' : ''} mesurée${3 - calibration.n > 1 ? 's' : ''} avant que le calcul se recale sur ta chaîne.`}
          {calibration.hits && ` Vidéos annoncées avec au moins 30 % de chances de doubler tes vues habituelles : ${calibration.hits.actualHigh} sur ${calibration.hits.predictedHigh} l’ont fait.`}
        </p>
      </div>
      {checks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-card px-4 py-6 text-center">
          <p className="text-[14px] text-muted-foreground">Pas encore d’évaluation. Évalue ta prochaine vidéo avant de la publier : son résultat réel s’affichera ici.</p>
          <Link href="/preflight?vue=evaluer" scroll={false} className="text-[14px] font-medium text-primary hover:underline">
            Évaluer ma prochaine vidéo
          </Link>
        </div>
      ) : (
        <>
          {/* Phone: one card per evaluation, nothing hidden sideways. */}
          <ul className="elev-1 flex flex-col overflow-hidden rounded-[22px] bg-card md:hidden">
            {checks.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 border-b border-muted px-4 py-3.5 last:border-b-0">
                <span className="text-[12px] text-muted-foreground">{date(c.createdAt)} · note {c.overall ?? '—'}/100</span>
                <span className="line-clamp-2 text-[14px] font-medium leading-snug">{c.title}</span>
                <span className="text-[13px] tabular-nums">
                  Prévu {c.predictedMultiple ? times(c.predictedMultiple) : '—'} → Réel à 7 jours {actual(c)}
                  <span className="text-muted-foreground"> (× tes vues habituelles)</span>
                </span>
                <div className="text-[13px]">{published(c)}</div>
              </li>
            ))}
          </ul>
          <div className="elev-1 hidden overflow-x-auto rounded-[22px] bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[13px] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Titre évalué</th>
                  <th className="px-3 py-2.5 text-right font-medium">Note /100</th>
                  <th className="px-3 py-2.5 text-right font-medium">Prévu (× tes vues habituelles)</th>
                  <th className="px-3 py-2.5 text-right font-medium">Réel à 7 jours</th>
                  <th className="px-4 py-2.5 font-medium">Vidéo publiée</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id} className="border-t border-muted">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{date(c.createdAt)}</td>
                    <td className="max-w-[260px] truncate px-3 py-2.5" title={c.title}>{c.title}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.overall ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.predictedMultiple ? times(c.predictedMultiple) : '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{actual(c)}</td>
                    <td className="max-w-[300px] px-4 py-2.5">{published(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** Choosing a video does nothing until "Rattacher" is pressed (arrow keys on a closed select used to link at once). */
function LinkPicker({ disabled, linkable, onLink }: { disabled: boolean; linkable: { id: string; title: string }[]; onLink: (videoId: string) => void }) {
  const [choice, setChoice] = useState('');
  return (
    <span className="flex min-w-0 items-center gap-2">
      <select
        disabled={disabled}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        aria-label="Vidéo publiée à rattacher"
        className="h-10 min-w-0 max-w-[220px] flex-1 rounded-md border border-input bg-background px-2 text-[13px]"
      >
        <option value="">{linkable.length ? 'Choisir la vidéo…' : 'Pas encore publiée'}</option>
        {linkable.map((v) => (
          <option key={v.id} value={v.id}>{v.title}</option>
        ))}
      </select>
      {linkable.length > 0 && (
        <button type="button" disabled={disabled || !choice} onClick={() => onLink(choice)} className="h-10 shrink-0 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          Rattacher
        </button>
      )}
    </span>
  );
}
