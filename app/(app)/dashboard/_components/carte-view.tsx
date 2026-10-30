'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PhaseBadge, SensitiveBadge } from '@/components/tublyti';
import { FeasibilityBadge } from '@/components/tublyti/feasibility-badge';
import type { FeasibilityGrade } from '@/lib/scoring/feasibility';

export interface CarteTopic {
  id: string;
  label: string;
  channel: string;
  phase: number;
  /** Potentiel 0–100. */
  potential: number;
  /** Demande 0–100 (rang du sujet dans sa thématique). */
  demand: number;
  /** Vidéos de qualité récentes, en multiple de la moyenne de la thématique (1 = moyenne). */
  supply: number;
  /** Part des commentaires qui réclament une vidéo ou se plaignent, en %. */
  frustration: number;
  feasibility: string | null;
  feasibilityReason: string | null;
  reliable: boolean;
  /** Le sujet a déjà des mesures (sinon : trop récent, pas assez de données). */
  measured: boolean;
  videos: number;
  sensitive: boolean;
}

const PHASE_VAR = ['var(--phase-0)', 'var(--phase-1)', 'var(--phase-2)', 'var(--phase-3)'];
const PHASE_NAME = ['À surveiller', 'Ça monte', 'C’est le moment', 'Trop tard'];
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** « Aucune », « ×0,4 », « ×2,5 » : nombre de bonnes vidéos comparé à la moyenne de la thématique. */
export function formatSupply(x: number): string {
  if (x <= 0) return 'Aucune';
  return `×${nf1.format(x)}`;
}

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return h;
}

// ─────────────────────────────── Graphique ───────────────────────────────

const W = 760;
const H = 420;
const PAD = { l: 48, r: 20, t: 16, b: 52 };

function Chart({
  topics,
  selectedId,
  onSelect,
  lowSupply,
}: {
  topics: CarteTopic[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  lowSupply: { demand: number; supply: number };
}) {
  const [hover, setHover] = useState<string | null>(null);

  // Échelle horizontale en racine carrée : sépare les sujets serrés près de zéro.
  const xMax = useMemo(() => {
    const sorted = topics.map((t) => t.supply).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 1;
    return [2, 4, 8, 16, 32].find((v) => v >= p95) ?? 32;
  }, [topics]);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (v: number) => PAD.l + (Math.sqrt(Math.min(v, xMax)) / Math.sqrt(xMax)) * iw;
  const y = (v: number) => PAD.t + (1 - Math.min(Math.max(v, 0), 100) / 100) * ih;
  const xTicks = [0, 0.5, 1, 2, 4, 8, 16, 32].filter((v) => v <= xMax);

  // Les meilleurs sujets sont dessinés en dernier, donc au-dessus.
  const ordered = [...topics].sort((a, b) => a.potential - b.potential);
  const active = topics.find((t) => t.id === (hover ?? selectedId));

  const pos = (t: CarteTopic) => {
    const h = hash(t.id);
    const jx = ((h % 100) / 100) * 6; // jusqu'à ±6 px pour séparer les points identiques
    const jy = (((h >> 8) % 100) / 100) * 6;
    // Les points restent dans la zone du graphique.
    const cx = Math.min(Math.max(x(t.supply) + jx, PAD.l + 8), W - PAD.r - 8);
    const cy = Math.min(Math.max(y(t.demand) + jy, PAD.t + 8), PAD.t + ih - 4);
    return { cx, cy };
  };

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Carte de ${topics.length} sujets : demande du public selon le nombre de bonnes vidéos existantes`}>
        {/* Zone des meilleures occasions */}
        <rect
          x={x(0)}
          y={y(100)}
          width={x(lowSupply.supply) - x(0)}
          height={y(lowSupply.demand) - y(100)}
          rx={12}
          fill="var(--phase-2-soft)"
          opacity={0.8}
        />
        <text x={x(0) + 12} y={y(100) + 22} fontSize={12} fontWeight={600} fill="var(--phase-2-ink)">
          Très demandés, peu traités
        </text>

        {/* Grille */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.l - 10} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line
              x1={x(v)}
              x2={x(v)}
              y1={PAD.t}
              y2={PAD.t + ih}
              stroke={v === 1 ? 'var(--muted-foreground)' : 'var(--border)'}
              strokeOpacity={v === 1 ? 0.45 : 1}
              strokeDasharray={v === 1 ? '4 4' : undefined}
            />
            <text x={x(v)} y={PAD.t + ih + 18} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
              {v === 0 ? '0' : v === 1 ? 'moyenne' : `×${nf1.format(v)}`}
            </text>
          </g>
        ))}
        <text x={PAD.l + iw / 2} y={H - 8} textAnchor="middle" fontSize={12} fontWeight={500} fill="var(--muted-foreground)">
          Bonnes vidéos déjà publiées (par rapport à la moyenne de la thématique) →
        </text>
        <text
          x={14}
          y={PAD.t + ih / 2}
          textAnchor="middle"
          fontSize={12}
          fontWeight={500}
          fill="var(--muted-foreground)"
          transform={`rotate(-90 14 ${PAD.t + ih / 2})`}
        >
          Demande du public (0 à 100) →
        </text>

        {/* Sujets */}
        {ordered.map((t) => {
          const { cx, cy } = pos(t);
          const r = 4 + (t.potential / 100) * 3.5;
          const on = t.id === selectedId;
          const hovered = t.id === hover;
          return (
            <g
              key={t.id}
              role="button"
              tabIndex={0}
              aria-label={`${t.label}, ${PHASE_NAME[t.phase]}, potentiel ${t.potential}`}
              aria-pressed={on}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(t.id);
                }
              }}
              onMouseEnter={() => setHover(t.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(t.id)}
              onBlur={() => setHover(null)}
              className="cursor-pointer outline-none"
            >
              {(on || hovered) && <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke="var(--ring)" strokeWidth={2} />}
              <circle
                cx={cx}
                cy={cy}
                r={hovered ? r + 1.5 : r}
                fill={PHASE_VAR[t.phase] ?? PHASE_VAR[0]}
                fillOpacity={on || hovered ? 1 : 0.82}
                stroke="var(--card)"
                strokeWidth={1.5}
              />
            </g>
          );
        })}
      </svg>

      {/* Info-bulle */}
      {active && (() => {
        const { cx, cy } = pos(active);
        const left = (cx / W) * 100;
        const top = (cy / H) * 100;
        const flip = left > 62;
        return (
          <div
            className="elev-3 pointer-events-none absolute z-10 w-60 rounded-xl bg-card px-3 py-2.5 text-[13px]"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              transform: `translate(${flip ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
            }}
          >
            <p className="font-semibold leading-snug">{active.label}</p>
            <p className="mt-1 text-muted-foreground">
              {PHASE_NAME[active.phase]} · Potentiel {active.potential}
            </p>
            <p className="text-muted-foreground">
              Demande {active.demand} · Bonnes vidéos {formatSupply(active.supply)}
            </p>
          </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────── Fiche ───────────────────────────────

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-muted px-4 py-3 last:border-b-0">
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Detail({ topic, isBest }: { topic: CarteTopic; isBest: boolean }) {
  return (
    <aside aria-label="Sujet sélectionné" className="flex flex-col gap-4 rounded-2xl bg-card p-5">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-muted-foreground">{isBest ? (topic.measured ? 'Le plus prometteur' : 'Le plus suivi') : topic.channel}</span>
        <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em]">{topic.label}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <PhaseBadge phase={topic.phase} />
          {topic.sensitive && <SensitiveBadge />}
          {topic.measured && !topic.reliable && <span className="text-xs text-muted-foreground">Peu de données</span>}
        </div>
      </div>

      {topic.measured ? (
        <div className="well overflow-hidden rounded-xl bg-background">
          <Row label="Potentiel" value={`${topic.potential} / 100`} />
          <Row label="Demande du public" hint="Comparée aux autres sujets de la thématique" value={`${topic.demand} / 100`} />
          <Row
            label="Bonnes vidéos existantes"
            hint={
              topic.supply < 0.8
                ? 'Moins que la moyenne : peu de concurrence'
                : topic.supply <= 1.25
                  ? 'Dans la moyenne de la thématique'
                  : 'Plus que la moyenne : concurrence forte'
            }
            value={formatSupply(topic.supply)}
          />
          <Row label="Public frustré" hint="Commentaires qui réclament une vidéo" value={`${topic.frustration} %`} />
          {topic.feasibility && (
            <Row
              label="Faisabilité"
              hint={topic.feasibilityReason ?? undefined}
              value={<FeasibilityBadge grade={topic.feasibility as FeasibilityGrade} />}
            />
          )}
        </div>
      ) : (
        <p className="rounded-xl bg-background px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          Sujet tout récent : {topic.videos} vidéo{topic.videos > 1 ? 's' : ''} repérée{topic.videos > 1 ? 's' : ''} pour l’instant. Son potentiel sera calculé dès
          qu’il y aura assez de vidéos et de commentaires.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Link
          href={`/sujets?sujet=${topic.id}&moment=tous`}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-medium text-primary-foreground"
        >
          Voir le sujet et créer la vidéo
        </Link>
        <Link href={`/topics/${topic.id}`} className="inline-flex items-center justify-center gap-1 text-sm font-medium text-primary">
          Fiche complète <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}

// ─────────────────────────────── Vue ───────────────────────────────

const COLS = 'grid-cols-[minmax(0,2.4fr)_150px_120px_84px_110px_96px_70px]';

export function CarteView({
  topics,
  selectedId: initialSelected,
  lowSupply,
  emptyHint,
}: {
  topics: CarteTopic[];
  selectedId: string | null;
  lowSupply: { demand: number; supply: number };
  emptyHint: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
  const measured = topics.filter((t) => t.measured);
  const pending = topics.length - measured.length;
  // Meilleur sujet : le plus fort potentiel parmi ceux dont les données sont fiables.
  const best = measured.find((t) => t.reliable && !t.sensitive) ?? measured[0] ?? topics[0] ?? null;
  const selected = topics.find((t) => t.id === selectedId) ?? null;
  const shown = selected ?? best;

  // Garde la sélection dans l'adresse (partage, retour arrière) sans recharger la page.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set('sujet', selectedId);
    else url.searchParams.delete('sujet');
    window.history.replaceState(null, '', url.toString());
  }, [selectedId]);

  if (!topics.length) {
    return <p className="rounded-2xl border border-dashed border-border px-6 py-14 text-center text-[15px] text-muted-foreground">{emptyHint}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="carte-titre" className="flex flex-col gap-3 rounded-2xl bg-card p-4 md:p-5">
          <h2 id="carte-titre" className="sr-only">Carte</h2>
          {measured.length >= 5 ? (
            <Chart topics={measured} selectedId={selectedId} onSelect={(id) => setSelectedId(id === selectedId ? null : id)} lowSupply={lowSupply} />
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <p className="text-[15px] font-medium">Pas assez de sujets mesurés pour dessiner la carte</p>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                Ces sujets viennent d’apparaître : TubLyTI n’a repéré que quelques vidéos sur chacun. Ils seront placés sur la carte dès que
                la collecte de nuit en aura trouvé assez. En attendant, ils sont listés ci-dessous, du plus suivi au moins suivi.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[13px] text-muted-foreground">
            {PHASE_NAME.map((n, i) => (
              <span key={n} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: PHASE_VAR[i] }} aria-hidden="true" />
                {n}
              </span>
            ))}
            <span>Taille du point : potentiel</span>
            {pending > 0 && (
              <span className="basis-full text-xs">
                {pending} sujet{pending > 1 ? 's' : ''} trop récent{pending > 1 ? 's' : ''} pour être placé{pending > 1 ? 's' : ''} : ils sont en bas du tableau.
              </span>
            )}
          </div>
        </section>
        {shown && <Detail topic={shown} isBest={!selected} />}
      </div>

      <section aria-label="Tous les sujets" className="overflow-x-auto rounded-2xl bg-card">
        <div className="min-w-[860px]">
          <div className={`grid ${COLS} items-end gap-4 border-b border-border px-5 py-3 text-[13px] font-medium text-muted-foreground`}>
            <span>Sujet</span>
            <span>Moment</span>
            <span>Potentiel</span>
            <span title="Demande du public, comparée aux autres sujets de la thématique (0 à 100)">Demande</span>
            <span title="Bonnes vidéos publiées, par rapport à la moyenne de la thématique">Bonnes vidéos</span>
            <span title="Part des commentaires qui réclament une vidéo ou se plaignent">Public frustré</span>
            <span title="Chances de réussir le sujet avec une petite chaîne (A = très bonnes)">Faisabilité</span>
          </div>
          <ol>
            {topics.map((t) => {
              const on = t.id === selectedId;
              return (
                <li key={t.id} className="border-b border-muted last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setSelectedId(on ? null : t.id)}
                    aria-pressed={on}
                    className={`grid w-full ${COLS} items-center gap-4 px-5 py-3 text-left transition-colors ${
                      on ? 'bg-primary-soft/50 shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-muted/60'
                    }`}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-medium">{t.label}</span>
                        {t.sensitive && <SensitiveBadge />}
                      </span>
                      <span className="truncate text-[13px] text-muted-foreground">{t.channel}</span>
                    </span>
                    <span><PhaseBadge phase={t.phase} /></span>
                    {t.measured ? (
                      <>
                        <span className="flex items-center gap-2">
                          <span className="w-7 text-[15px] font-semibold tabular-nums">{t.potential}</span>
                          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-primary" style={{ width: `${t.potential}%` }} />
                          </span>
                        </span>
                        <span className="text-[15px] tabular-nums">{t.demand}</span>
                        <span className="text-[15px] tabular-nums">{formatSupply(t.supply)}</span>
                        <span className="text-[15px] tabular-nums">{t.frustration} %</span>
                        <span>{t.feasibility ? <FeasibilityBadge grade={t.feasibility as FeasibilityGrade} /> : <span className="text-muted-foreground">—</span>}</span>
                      </>
                    ) : (
                      <span className="col-span-5 text-[13px] text-muted-foreground">
                        Pas encore mesuré · {t.videos} vidéo{t.videos > 1 ? 's' : ''} repérée{t.videos > 1 ? 's' : ''}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
}
