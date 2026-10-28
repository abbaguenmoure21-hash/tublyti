'use client';

import { Fragment, useState } from 'react';
import { Line, LineChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown } from 'lucide-react';
import { loadRetention } from '@/lib/actions/analytics';
import type { RetentionState } from '@/lib/youtube/analytics';
import { AnalyzeVideoButton } from '@/components/tublyti/video-analysis';
import { Skeleton } from '@/components/ui/skeleton';

const nf = new Intl.NumberFormat('fr-FR');
const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const pct = (v: number, d = 0) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: d })} %`;
function duration(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m} min ${String(r).padStart(2, '0')}` : `${r} s`;
}
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export interface TopVideoRow {
  id: string;
  title: string;
  views: number;
  minutes: number;
  avgDuration: number;
  avgPercent: number;
  subscribers: number;
  revenue: number | null;
  /** Impressions et taux de clic de la miniature (null tant que YouTube n'a pas livré de rapport). */
  impressions?: number | null;
  ctr?: number | null;
}

function RetentionTip({ active, payload, lengthS }: { active?: boolean; payload?: { payload: { at: number; watch: number } }[]; lengthS: number | null }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="elev-3 rounded-xl bg-card px-3 py-2 text-[13px]">
      <p className="text-muted-foreground">{lengthS ? `À ${clock(p.at * lengthS)}` : `À ${pct(p.at * 100)} de la vidéo`}</p>
      <p className="font-semibold tabular-nums">
        {p.watch > 1 ? `${pct(p.watch * 100)} : passage revu par une partie des spectateurs` : `${pct(p.watch * 100)} des spectateurs encore là`}
      </p>
    </div>
  );
}

/** Lecture de la courbe : décrochage du début, moitié, fin, et comparaison aux vidéos de même durée. */
function RetentionPanel({ state, lengthS }: { state: RetentionState; lengthS: number | null }) {
  if (state.status === 'absent') return <p className="text-sm text-muted-foreground">Connecte YouTube Analytics pour voir la rétention.</p>;
  if (state.status === 'erreur') {
    return (
      <p className="text-sm text-muted-foreground">
        {state.reason === 'vide'
          ? 'Pas encore assez de vues pour que YouTube calcule la rétention de cette vidéo.'
          : state.reason === 'acces-retire'
            ? 'L’accès à YouTube Analytics a été retiré : reconnecte-le en haut de la section.'
            : 'YouTube Analytics ne répond pas pour le moment. Réessaie plus tard.'}
      </p>
    );
  }
  const pts = state.data.points;
  const at = (r: number) => pts.reduce((best, p) => (Math.abs(p.at - r) < Math.abs(best.at - r) ? p : best), pts[0]).watch;
  const start = at(0.05);
  const half = at(0.5);
  const end = at(0.95);
  const rel = state.data.relativeAvg;
  const relText =
    rel === null ? null : rel >= 0.6 ? 'Meilleure que la plupart des vidéos YouTube de même durée.' : rel <= 0.4 ? 'Moins bonne que la plupart des vidéos YouTube de même durée.' : 'Dans la moyenne des vidéos YouTube de même durée.';
  // Plus forte chute entre deux points consécutifs (hors tout début).
  let drop = { at: 0, size: 0 };
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i - 1].watch - pts[i].watch;
    if (pts[i].at > 0.03 && d > drop.size) drop = { at: pts[i].at, size: d };
  }
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-3 gap-2">
        {[
          ['Après l’intro', start],
          ['À mi-parcours', half],
          ['À la fin', end],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-xl bg-background px-3 py-2">
            <dt className="text-[12px] text-muted-foreground">{label}</dt>
            <dd className="text-[17px] font-semibold tabular-nums">{pct((v as number) * 100)}</dd>
          </div>
        ))}
      </dl>
      <div className="h-48 w-full" role="img" aria-label={`Part des spectateurs encore présents au fil de la vidéo : ${pct(start * 100)} après l’intro, ${pct(half * 100)} à mi-parcours, ${pct(end * 100)} à la fin.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pts} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis
              dataKey="at"
              type="number"
              domain={[0, 1]}
              tickFormatter={(v) => (lengthS ? clock(v * lengthS) : `${Math.round(v * 100)} %`)}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis tickFormatter={(v) => `${Math.round(v * 100)} %`} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} width={44} domain={[0, 'auto']} />
            <Tooltip content={<RetentionTip lengthS={lengthS} />} cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.4 }} />
            {drop.size > 0.03 && <ReferenceLine x={drop.at} stroke="var(--warning)" strokeDasharray="4 4" />}
            {pts.some((p) => p.watch > 1) && (
              <ReferenceLine y={1} stroke="var(--muted-foreground)" strokeOpacity={0.5} label={{ value: '100 %', position: 'insideTopRight', fontSize: 12, fill: 'var(--muted-foreground)' }} />
            )}
            <Line type="monotone" dataKey="watch" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {relText}
        {drop.size > 0.03 && ` La plus forte chute (pointillés) arrive ${lengthS ? `vers ${clock(drop.at * lengthS)}` : `à ${pct(drop.at * 100)} de la vidéo`} : regarde ce qui s’y passe.`}
        {' '}Au-delà de 100 %, des spectateurs reviennent en arrière ou revoient ce passage.
      </p>
    </div>
  );
}

export function TopVideos({ channelId, rows, hasRevenue }: { channelId: string; rows: TopVideoRow[]; hasRevenue: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, RetentionState | 'failed'>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const fetchRetention = async (id: string) => {
    setLoading((l) => ({ ...l, [id]: true }));
    setCache((c) => {
      const next = { ...c };
      delete next[id];
      return next;
    });
    try {
      const res = await loadRetention(channelId, id);
      setCache((c) => ({ ...c, [id]: res as RetentionState }));
    } catch {
      setCache((c) => ({ ...c, [id]: 'failed' }));
    } finally {
      setLoading((l) => ({ ...l, [id]: false }));
    }
  };

  const toggle = (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (!cache[id] && !loading[id]) void fetchRetention(id);
  };

  const retentionBody = (id: string, lengthS: number | null) => {
    const state = cache[id];
    if (state === 'failed') {
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">La rétention n’a pas pu être lue.</p>
          <button type="button" onClick={() => void fetchRetention(id)} className="inline-flex h-10 items-center rounded-lg px-3 text-[13px] font-medium text-primary hover:bg-muted md:h-8">
            Réessayer
          </button>
        </div>
      );
    }
    if (state) return <RetentionPanel state={state} lengthS={lengthS} />;
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <span className="sr-only">Lecture de la rétention sur YouTube…</span>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  };
  const cols = hasRevenue ? 10 : 9;

  return (
    <>
    {/* Phones: one card per video, nothing scrolls sideways */}
    <ul className="md:hidden">
      {rows.map((v) => {
        const isOpen = open === v.id;
        const lengthS = v.avgPercent > 0 ? v.avgDuration / (v.avgPercent / 100) : null;
        return (
          <li key={v.id} className="flex flex-col gap-3 border-t border-muted px-4 py-4 first:border-t-0">
            <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="line-clamp-2 text-[15px] font-medium hover:underline">{v.title}</a>
            <div className="flex items-baseline gap-2">
              <span className="text-[22px] font-semibold tabular-nums">{nf.format(v.views)}</span>
              <span className="text-[13px] text-muted-foreground">vues</span>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-[13px]">
              <div><dt className="text-muted-foreground">Regardé</dt><dd className="tabular-nums">{pct(v.avgPercent)}</dd></div>
              <div><dt className="text-muted-foreground">Taux de clic</dt><dd className="tabular-nums">{v.ctr == null ? '—' : pct(v.ctr * 100, 1)}</dd></div>
              <div><dt className="text-muted-foreground">Abonnés</dt><dd className="tabular-nums">+{nf.format(v.subscribers)}</dd></div>
            </dl>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => toggle(v.id)}
                aria-expanded={isOpen}
                className="inline-flex h-11 items-center justify-center gap-1 rounded-lg border border-border text-[14px] font-medium text-primary hover:bg-muted"
              >
                Rétention
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              <div className="flex items-center justify-center rounded-lg border border-border">
                <AnalyzeVideoButton videoId={v.id} title={v.title} channelId={channelId} variant="link" />
              </div>
            </div>
            {isOpen && <div className="rounded-xl bg-muted/40 p-3">{retentionBody(v.id, lengthS)}</div>}
          </li>
        );
      })}
    </ul>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="text-left text-[13px] text-muted-foreground">
            <th className="sticky left-0 z-10 bg-card px-4 py-2 font-medium">Vidéo</th>
            <th className="px-3 py-2 text-right font-medium" title="Nombre de fois où la miniature a été vue">Impressions</th>
            <th className="px-3 py-2 text-right font-medium" title="Part des impressions qui ont donné un clic (CTR)">Taux de clic</th>
            <th className="px-3 py-2 text-right font-medium">Vues</th>
            <th className="px-3 py-2 text-right font-medium">Heures</th>
            <th className="px-3 py-2 text-right font-medium">Durée moy.</th>
            <th className="px-3 py-2 text-right font-medium">Regardé</th>
            <th className="px-3 py-2 text-right font-medium">Abonnés</th>
            {hasRevenue && <th className="px-3 py-2 text-right font-medium">Revenus</th>}
            <th className="px-4 py-2 text-right font-medium"><span className="sr-only">Rétention</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const isOpen = open === v.id;
            // Durée de la vidéo estimée : durée moyenne regardée ÷ part regardée.
            const lengthS = v.avgPercent > 0 ? v.avgDuration / (v.avgPercent / 100) : null;
            return (
              <Fragment key={v.id}>
                <tr className="border-t border-muted">
                  <td className="sticky left-0 z-10 max-w-[300px] truncate bg-card px-4 py-2.5">
                    <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="hover:underline">{v.title}</a>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{v.impressions == null ? '—' : nf.format(v.impressions)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{v.ctr == null ? '—' : pct(v.ctr * 100, 1)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{nf.format(v.views)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{nf.format(Math.round(v.minutes / 60))}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{duration(v.avgDuration)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(v.avgPercent)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">+{nf.format(v.subscribers)}</td>
                  {hasRevenue && <td className="px-3 py-2.5 text-right tabular-nums">{v.revenue === null ? '—' : usd.format(v.revenue)}</td>}
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <AnalyzeVideoButton videoId={v.id} title={v.title} channelId={channelId} variant="link" />
                    <button
                      type="button"
                      onClick={() => toggle(v.id)}
                      aria-expanded={isOpen}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-primary hover:bg-muted"
                    >
                      Rétention
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={cols} className="bg-muted/40 px-4 py-4">
                      {retentionBody(v.id, lengthS)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
