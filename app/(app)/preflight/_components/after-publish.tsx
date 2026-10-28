'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { linkCheckToVideo } from '@/lib/actions/preflight';
import type { CheckRow, FollowRow } from '@/lib/preflight/engine';

const nf = new Intl.NumberFormat('fr-FR');
const times = (m: number) => `×${m.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;
const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

const STATUS: Record<FollowRow['status'], { label: string; cls: string }> = {
  above: { label: 'Au-dessus', cls: 'bg-phase-2-soft text-phase-2-ink' },
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
  const link = (id: string, videoId: string) =>
    start(async () => {
      const r = await linkCheckToVideo(id, videoId || null);
      if (!r.ok) toast.error(r.message ?? 'Échec');
      else toast('Évaluation rattachée', { description: 'Le résultat sera mesuré 7 jours après la publication.' });
    });

  return (
    <section aria-labelledby="pf-hist" className="flex flex-col gap-3">
      <div>
        <h2 id="pf-hist" className="text-lg font-semibold">Mes prédictions et leurs résultats</h2>
        <p className="text-[13px] text-muted-foreground">
          Chaque évaluation est rattachée à la vidéo publiée (automatiquement si le titre est proche), puis mesurée à 7 jours.
          {calibration.n >= 3
            ? ` Sur tes ${calibration.n} vidéos mesurées, tes résultats valent en moyenne ${times(calibration.factor)} la prédiction : les prochaines en tiennent compte.`
            : ` Encore ${3 - calibration.n} vidéo${3 - calibration.n > 1 ? 's' : ''} mesurée${3 - calibration.n > 1 ? 's' : ''} avant que le modèle se recale sur ta chaîne.`}
          {calibration.hits && ` Vidéos annoncées avec au moins 30 % de chances de doubler tes vues habituelles :${calibration.hits.actualHigh} sur ${calibration.hits.predictedHigh} l’ont fait.`}
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
        <div className="elev-1 overflow-x-auto rounded-[22px] bg-card">
          <table className="w-full min-w-[720px] text-sm">
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
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {c.actualMultiple !== null ? (
                      <span className={c.actualMultiple >= (c.predictedMultiple ?? 1) ? 'font-semibold text-phase-2-ink' : 'font-semibold'}>{times(c.actualMultiple)}</span>
                    ) : c.pendingDays !== null ? (
                      <span className="text-muted-foreground">dans {c.pendingDays} j</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.videoId ? (
                      <a href={`https://www.youtube.com/watch?v=${c.videoId}`} target="_blank" rel="noreferrer" className="block max-w-[220px] truncate text-primary hover:underline">{c.videoTitle ?? c.videoId}</a>
                    ) : (
                      <select
                        disabled={pending || !linkable.length}
                        defaultValue=""
                        onChange={(e) => link(c.id, e.target.value)}
                        aria-label="Rattacher à une vidéo publiée"
                        className="h-8 max-w-[220px] rounded-md border border-input bg-background px-2 text-[13px]"
                      >
                        <option value="">{linkable.length ? 'Rattacher à…' : 'Pas encore publiée'}</option>
                        {linkable.map((v) => (
                          <option key={v.id} value={v.id}>{v.title}</option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
