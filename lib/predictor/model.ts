/**
 * Modèle de prédiction des vues (TubLyTI) — régression ridge sur le log du score de sur-performance
 * (vues d'une vidéo ÷ vues habituelles de sa chaîne au même âge), entraînée chaque semaine
 * sur toutes les vidéos suivies par TubLyTI (scripts/train-predictor.ts).
 *
 * Paramètres utilisés (ceux qu'on sait mesurer sur des milliers de vidéos) :
 *  - le moment : jour de la semaine, heure, saison ;
 *  - la chaîne : abonnés, vues habituelles, élan des 5 dernières vidéos, jours depuis la vidéo précédente ;
 *  - le sujet : phase, potentiel (MGI), nombre de vidéos concurrentes publiées dans les 7 jours avant ;
 *  - le format : durée, Short ou non ;
 *  - l'emballage : forme du titre, longueur du titre.
 * Le titre (ressemblance avec les gagnants), la miniature, le script et le montage s'ajoutent ensuite
 * dans la note avant publication.
 */

import { titleChecks } from '../preflight/titles';

export const MODEL_KEY = 'predictor_model_v1';

export interface FeatureContext {
  durationS: number | null;
  publishedAt: Date;
  subscribers: number | null;
  baselineViews: number | null;
  /** Moyenne du log des scores des 5 vidéos précédentes de la chaîne (élan). */
  momentum: number | null;
  daysSincePrev: number | null;
  title: string;
  topicPhase: number | null;
  topicMgi: number | null;
  topicRecent7d: number;
}

export const FEATURE_LABELS: Record<string, string> = {
  dur_log: 'Durée de la vidéo',
  is_short: 'Format Short',
  dow_1: 'Publication un lundi',
  dow_2: 'Publication un mardi',
  dow_3: 'Publication un mercredi',
  dow_4: 'Publication un jeudi',
  dow_5: 'Publication un vendredi',
  dow_6: 'Publication un samedi',
  hour_sin: 'Heure de publication',
  hour_cos: 'Heure de publication',
  month_sin: 'Saison',
  month_cos: 'Saison',
  subs_log: 'Taille de la chaîne',
  baseline_log: 'Vues habituelles de la chaîne',
  momentum: 'Élan des dernières vidéos',
  momentum_missing: 'Historique de la chaîne',
  gap_log: 'Temps depuis la vidéo précédente',
  title_form: 'Forme du titre',
  title_len: 'Longueur du titre',
  title_len2: 'Longueur du titre',
  phase_1: 'Sujet émergent',
  phase_2: 'Sujet en croissance',
  phase_3: 'Sujet en pic',
  mgi: 'Potentiel du sujet',
  mgi_missing: 'Sujet inconnu',
  saturation: 'Concurrence des 7 derniers jours',
};
export const FEATURES = Object.keys(FEATURE_LABELS);

export function vectorize(c: FeatureContext): number[] {
  const d = c.publishedAt;
  const dow = d.getUTCDay();
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const month = d.getUTCMonth();
  const dur = c.durationS ?? 600;
  const len = c.title.trim().length;
  const form = titleChecks(c.title).formScore / 100;
  const v: Record<string, number> = {
    dur_log: Math.log1p(dur / 60),
    is_short: dur <= 60 ? 1 : 0,
    dow_1: dow === 1 ? 1 : 0,
    dow_2: dow === 2 ? 1 : 0,
    dow_3: dow === 3 ? 1 : 0,
    dow_4: dow === 4 ? 1 : 0,
    dow_5: dow === 5 ? 1 : 0,
    dow_6: dow === 6 ? 1 : 0,
    hour_sin: Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * hour) / 24),
    month_sin: Math.sin((2 * Math.PI * month) / 12),
    month_cos: Math.cos((2 * Math.PI * month) / 12),
    subs_log: Math.log10((c.subscribers ?? 0) + 1),
    baseline_log: Math.log10((c.baselineViews ?? 0) + 1),
    momentum: c.momentum ?? 0,
    momentum_missing: c.momentum === null ? 1 : 0,
    gap_log: Math.log1p(Math.max(0, c.daysSincePrev ?? 7)),
    title_form: form,
    title_len: len / 100,
    title_len2: (len / 100) ** 2,
    phase_1: c.topicPhase === 1 ? 1 : 0,
    phase_2: c.topicPhase === 2 ? 1 : 0,
    phase_3: c.topicPhase === 3 ? 1 : 0,
    mgi: (c.topicMgi ?? 50) / 100,
    mgi_missing: c.topicMgi === null ? 1 : 0,
    saturation: Math.log1p(c.topicRecent7d),
  };
  return FEATURES.map((f) => v[f]);
}

export interface TrainedModel {
  version: 1;
  trainedAt: string;
  n: number;
  features: string[];
  mean: number[];
  std: number[];
  weights: number[];
  intercept: number;
  /** Quantiles des résidus (log) : servent à transformer la prédiction en probabilités. */
  residuals: number[];
  metrics: { testN: number; r2: number; maeLog: number; brierP2x: number; baseBrierP2x: number; baseP2x: number };
}

/** Résout (A + λI) w = b par élimination de Gauss (A symétrique, petite taille). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / p;
      if (!f) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-9));
}

export function fitRidge(X: number[][], y: number[], lambda = 2): Omit<TrainedModel, 'version' | 'trainedAt' | 'metrics'> {
  const n = X.length;
  const k = X[0].length;
  const mean = Array(k).fill(0);
  const std = Array(k).fill(0);
  for (const row of X) row.forEach((v, j) => (mean[j] += v / n));
  for (const row of X) row.forEach((v, j) => (std[j] += (v - mean[j]) ** 2 / n));
  for (let j = 0; j < k; j++) std[j] = Math.sqrt(std[j]) || 1;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const A = Array.from({ length: k }, () => Array(k).fill(0));
  const b = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const z = X[i].map((v, j) => (v - mean[j]) / std[j]);
    const t = y[i] - yMean;
    for (let a = 0; a < k; a++) {
      b[a] += z[a] * t;
      for (let c = a; c < k; c++) A[a][c] += z[a] * z[c];
    }
  }
  for (let a = 0; a < k; a++) for (let c = 0; c < a; c++) A[a][c] = A[c][a];
  for (let a = 0; a < k; a++) A[a][a] += lambda;
  const weights = solve(A, b);
  const residualsAll = X.map((row, i) => y[i] - predictRaw({ mean, std, weights, intercept: yMean }, row)).sort((a, b) => a - b);
  const residuals = Array.from({ length: 101 }, (_, q) => residualsAll[Math.min(residualsAll.length - 1, Math.round((q / 100) * (residualsAll.length - 1)))]);
  return { n, features: FEATURES, mean, std, weights, intercept: yMean, residuals };
}

export function predictRaw(m: Pick<TrainedModel, 'mean' | 'std' | 'weights' | 'intercept'>, x: number[]): number {
  let s = m.intercept;
  for (let j = 0; j < x.length; j++) s += m.weights[j] * ((x[j] - m.mean[j]) / m.std[j]);
  return s;
}

/** Probabilité que log(score réel) dépasse un seuil, d'après la distribution des résidus. */
export function probAbove(m: Pick<TrainedModel, 'residuals'>, logPred: number, threshold: number): number {
  const r = m.residuals;
  if (!r?.length) return 0;
  const need = threshold - logPred;
  let above = 0;
  for (const x of r) if (x > need) above++;
  return above / r.length;
}

/** Contribution de chaque paramètre à la prédiction (en log), regroupée par libellé. */
export function drivers(m: TrainedModel, x: number[]): { label: string; effect: number }[] {
  const byLabel = new Map<string, number>();
  x.forEach((v, j) => {
    const effect = m.weights[j] * ((v - m.mean[j]) / m.std[j]);
    const label = FEATURE_LABELS[m.features[j]] ?? m.features[j];
    byLabel.set(label, (byLabel.get(label) ?? 0) + effect);
  });
  return [...byLabel.entries()].map(([label, effect]) => ({ label, effect })).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}
