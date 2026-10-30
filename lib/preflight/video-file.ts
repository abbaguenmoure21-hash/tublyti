import type { SupabaseClient } from '@supabase/supabase-js';
import { geminiJson } from '../ai/gemini';
import { estimateCostUsd, MAX_MIN } from '../video/analyze';

/**
 * Vidéo finie, avant publication : envoyée directement par le navigateur à Gemini (Files API, 2 Go max,
 * effacée par Google sous 48 h — et par nous dès l'analyse faite), puis notée : montage, son, image,
 * rétention prévue seconde par seconde.
 */

const BASE = 'https://generativelanguage.googleapis.com';

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY manquante');
  return k;
}

/** Ouvre un envoi « resumable » : renvoie l'adresse où le navigateur dépose le fichier (sans la clé). */
export async function startUpload(size: number, mimeType: string, displayName: string): Promise<string> {
  const res = await fetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key(),
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
  });
  const url = res.headers.get('x-goog-upload-url');
  if (!res.ok || !url) throw new Error(`Envoi refusé par Gemini (${res.status}).`);
  return url;
}

export async function fileState(
  name: string,
): Promise<{ state: string; uri?: string; mimeType?: string; durationS?: number | null; error?: string }> {
  if (!/^files\/[\w-]+$/.test(name)) throw new Error('Fichier invalide');
  const res = await fetch(`${BASE}/v1beta/${name}`, { headers: { 'x-goog-api-key': key() }, cache: 'no-store' });
  const j = (await res.json().catch(() => ({}))) as {
    state?: string;
    uri?: string;
    mimeType?: string;
    videoMetadata?: { videoDuration?: string };
    error?: { message?: string };
  };
  if (!res.ok) return { state: 'FAILED', error: j.error?.message ?? `HTTP ${res.status}` };
  // Duration as measured by Google (e.g. "312.5s"), never the one sent by the browser.
  const d = parseFloat(String(j.videoMetadata?.videoDuration ?? '').replace(/s$/, ''));
  return { state: j.state ?? 'PROCESSING', uri: j.uri, mimeType: j.mimeType, durationS: Number.isFinite(d) && d > 0 ? d : null };
}

/** Max length of a finished video sent to « Avant publication » (same cap as the video analysis). */
export const PREFLIGHT_VIDEO_MAX_S = MAX_MIN * 60;

export async function deleteFile(name: string): Promise<void> {
  if (!/^files\/[\w-]+$/.test(name)) return;
  await fetch(`${BASE}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key() } }).catch(() => null);
}

export interface VideoFileScore {
  score: number;
  durationS: number | null;
  criteria: { key: string; label: string; score: number; note: string }[];
  /** Rétention prévue : part des spectateurs encore là (0-1) à chaque dixième de la vidéo. */
  retention: { at_pct: number; watch: number }[];
  drops: { at_s: number; issue: string; fix: string }[];
  audio: string;
  cuts_per_minute: number | null;
  strengths: string[];
  fixes: string[];
}

const CRITERIA: [string, string][] = [
  ['hook', 'Accroche visuelle et sonore (0-30 s)'],
  ['pacing', 'Rythme du montage'],
  ['audio', 'Son (voix claire, niveau, musique)'],
  ['visuals', 'Qualité et variété des images'],
  ['text', 'Texte à l’écran et sous-titres'],
  ['structure', 'Structure et relances'],
  ['ending', 'Fin et appel à l’action'],
];

const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strs = (v: unknown, max = 6) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, max) : []);

export async function scoreVideoFile(
  db: SupabaseClient,
  file: { uri: string; mimeType: string },
  title: string,
  durationS: number | null,
): Promise<VideoFileScore> {
  if (durationS !== null && durationS > PREFLIGHT_VIDEO_MAX_S) {
    throw new Error(`Vidéo trop longue : l’analyse est limitée à ${MAX_MIN} minutes.`);
  }
  const long = (durationS ?? 0) > 20 * 60;
  // Unknown duration: estimate at the cap, so the budget check stays on the safe side.
  const estUsd = estimateCostUsd(durationS ?? PREFLIGHT_VIDEO_MAX_S);
  const { data } = await geminiJson<Record<string, unknown>>(
    db,
    [
      { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
      {
        text: `You are a senior YouTube editor and retention analyst. This is a FINISHED video, not yet published, titled "${title}".
Watch and listen to all of it. Judge it like YouTube's audience would: would people keep watching?
1. Score each criterion 0-100, strictly (50 = average YouTube video, 80+ = top 10%).
2. Predict the audience retention curve: share of viewers still watching (0-1) at 0%, 10%, 20% ... 100% of the video. Be realistic: a typical video loses 30-45% in the first 30 seconds and ends around 20-40%.
3. List the precise moments (seconds) where viewers are likely to leave, why, and the concrete edit to fix it (cut, add B-roll, tighten, add a pattern interrupt, fix audio...).
4. Describe the audio (voice clarity, loudness, music level vs voice, noise) and estimate cuts per minute.
Write all text in FRENCH (tutoiement, concrete, cite real moments). ${long ? 'The video is long: focus on the first 3 minutes and the biggest problems.' : ''}
Answer JSON only:
{"duration_s": 0, "criteria": {${CRITERIA.map(([k]) => `"${k}": {"score": 0, "note": ""}`).join(', ')}}, "retention": [1, 0.7, 0.6, 0.55, 0.5, 0.47, 0.44, 0.41, 0.38, 0.35, 0.3], "drops": [{"at_s": 0, "issue": "", "fix": ""}], "audio": "", "cuts_per_minute": 0, "score": 0, "strengths": [""], "fixes": [""]}`,
      },
    ],
    { action: 'preflight_video', estUsd, maxOutputTokens: 3000, timeoutMs: 240_000, mediaResolution: 'MEDIA_RESOLUTION_LOW', meta: { title } },
  );
  const c = (data.criteria ?? {}) as Record<string, { score?: number; note?: string }>;
  const criteria = CRITERIA.map(([k, label]) => ({ key: k, label, score: clamp(c[k]?.score), note: str(c[k]?.note, 260) }));
  const avg = criteria.reduce((s, x) => s + x.score, 0) / criteria.length;
  const ret = Array.isArray(data.retention) ? (data.retention as unknown[]).map((x) => Math.max(0, Math.min(1.2, Number(x) || 0))).slice(0, 11) : [];
  const cpm = Number(data.cuts_per_minute);
  return {
    // L'accroche compte double, comme pour le script.
    score: Math.round((criteria[0].score * 2 + avg * criteria.length) / (criteria.length + 2)),
    durationS: Number(data.duration_s) > 0 ? Math.round(Number(data.duration_s)) : durationS,
    criteria,
    retention: ret.map((w, i) => ({ at_pct: i * 10, watch: Math.round(w * 1000) / 1000 })),
    drops: Array.isArray(data.drops)
      ? (data.drops as { at_s?: number; issue?: string; fix?: string }[]).slice(0, 8).map((d) => ({ at_s: Math.max(0, Math.round(Number(d.at_s) || 0)), issue: str(d.issue, 300), fix: str(d.fix, 300) }))
      : [],
    audio: str(data.audio, 500),
    cuts_per_minute: Number.isFinite(cpm) && cpm > 0 ? Math.round(cpm * 10) / 10 : null,
    strengths: strs(data.strengths, 4),
    fixes: strs(data.fixes, 6),
  };
}
