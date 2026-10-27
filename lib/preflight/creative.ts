import type { SupabaseClient } from '@supabase/supabase-js';
import { geminiJson, type GeminiPart } from '../ai/gemini';

/**
 * Note de la miniature et du script par Gemini, comparés aux vidéos qui ont sur-performé dans la niche.
 */

export interface ThumbnailScore {
  score: number;
  criteria: { key: string; label: string; score: number; note: string }[];
  strengths: string[];
  fixes: string[];
  compared_with: number;
}

export interface ScriptScore {
  score: number;
  hook: { score: number; verdict: string; rewrite: string };
  criteria: { key: string; label: string; score: number; note: string }[];
  risks: { at_pct: number; issue: string; fix: string }[];
  strengths: string[];
  fixes: string[];
  words: number;
  est_minutes: number;
}

const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strs = (v: unknown, max = 6) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, max) : []);

async function fetchThumb(videoId: string): Promise<string | null> {
  const res = await fetch(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!res?.ok) return null;
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

const THUMB_CRITERIA: [string, string][] = [
  ['mobile', 'Lisible en petit (mobile)'],
  ['focus', 'Un seul point focal clair'],
  ['contrast', 'Contraste et couleurs'],
  ['emotion', 'Émotion / intrigue'],
  ['text', 'Texte (3-4 mots max, gros)'],
  ['title_fit', 'Complète le titre sans le répéter'],
  ['niche_fit', 'Au niveau des gagnantes de la niche'],
];

export async function scoreThumbnail(
  db: SupabaseClient,
  image: { mimeType: string; base64: string },
  title: string,
  winners: { id: string; title: string; score: number }[],
): Promise<ThumbnailScore> {
  const refs: GeminiPart[] = [];
  let compared = 0;
  for (const w of winners.slice(0, 4)) {
    const b64 = await fetchThumb(w.id);
    if (!b64) continue;
    refs.push({ text: `Reference ${compared + 1} — "${w.title}" (did ${w.score.toFixed(1)}x its channel's usual views)` }, { inlineData: { mimeType: 'image/jpeg', data: b64 } });
    compared++;
  }
  const parts: GeminiPart[] = [
    {
      text: `You are a YouTube packaging expert. Judge the CANDIDATE thumbnail for a video titled "${title}".
${compared ? `Compare it with ${compared} thumbnails that strongly over-performed in the same niche (shown first).` : 'No reference thumbnails available: judge against YouTube best practices.'}
Score each criterion 0-100, be strict and specific (a 50 is average YouTube, 80+ is top 10% of the niche).
Write every text in FRENCH (tutoiement, concrete, actionable, mention real elements of the image).
Answer JSON only:
{"criteria": {${THUMB_CRITERIA.map(([k]) => `"${k}": {"score": 0, "note": ""}`).join(', ')}}, "score": 0, "strengths": ["..."], "fixes": ["concrete change 1", "..."]}`,
    },
    ...refs,
    { text: 'CANDIDATE thumbnail:' },
    { inlineData: { mimeType: image.mimeType, data: image.base64 } },
  ];
  const { data } = await geminiJson<Record<string, unknown>>(db, parts, { action: 'preflight_thumbnail', maxOutputTokens: 1500, meta: { title } });
  const c = (data.criteria ?? {}) as Record<string, { score?: number; note?: string }>;
  const criteria = THUMB_CRITERIA.map(([key, label]) => ({ key, label, score: clamp(c[key]?.score), note: str(c[key]?.note, 240) }));
  const avg = Math.round(criteria.reduce((s, x) => s + x.score, 0) / criteria.length);
  return {
    score: data.score != null ? Math.round((clamp(data.score) + avg) / 2) : avg,
    criteria,
    strengths: strs(data.strengths, 4),
    fixes: strs(data.fixes, 5),
    compared_with: compared,
  };
}

const SCRIPT_CRITERIA: [string, string][] = [
  ['promise', 'Tient la promesse du titre'],
  ['open_loops', 'Boucles ouvertes / relances'],
  ['pacing', 'Rythme (pas de longueurs)'],
  ['clarity', 'Clarté et phrases parlées'],
  ['story', 'Récit, exemples concrets'],
  ['payoff', 'Fin forte et appel à l’action'],
];

/** Ce qui marche dans la niche, d'après les analyses vidéo déjà faites sur des vidéos gagnantes. */
async function nicheHookPatterns(db: SupabaseClient, winnerIds: string[]): Promise<string> {
  if (!winnerIds.length) return '';
  const { data } = await db.from('video_analyses').select('title, analysis').in('video_id', winnerIds).eq('status', 'done').limit(5);
  const rows = (data ?? []) as { title: string | null; analysis: { hook?: { technique?: string; said?: string }; retention_devices?: { technique?: string }[]; format?: { pacing?: string } } | null }[];
  return rows
    .filter((r) => r.analysis)
    .map((r) => `- "${r.title}": hook = ${r.analysis?.hook?.technique ?? '?'} ("${(r.analysis?.hook?.said ?? '').slice(0, 160)}"); devices = ${(r.analysis?.retention_devices ?? []).map((d) => d.technique).slice(0, 4).join(', ')}; pacing = ${r.analysis?.format?.pacing ?? '?'}`)
    .join('\n');
}

export async function scoreScript(db: SupabaseClient, script: string, title: string, winnerIds: string[]): Promise<ScriptScore> {
  const text = script.trim().slice(0, 40_000);
  const words = text.split(/\s+/).filter(Boolean).length;
  const patterns = await nicheHookPatterns(db, winnerIds);
  const parts: GeminiPart[] = [
    {
      text: `You are a YouTube scriptwriter who specializes in audience retention. Evaluate this script for a video titled "${title}".
${patterns ? `What worked in over-performing videos of the same niche:\n${patterns}\n` : ''}
Judge the HOOK (first ~30 seconds = first ~75 words) hardest: it must confirm the title's promise immediately, create a strong open loop and give a reason to stay.
Then find the places where viewers are likely to leave (give their position as % of the script) and how to fix each one.
Score 0-100, strict (50 = average YouTube, 80+ = top 10%). Write all text in FRENCH (tutoiement, concrete). The hook rewrite must stay in the SCRIPT's language.
Answer JSON only:
{"hook": {"score": 0, "verdict": "", "rewrite": "improved first 2-4 sentences"}, "criteria": {${SCRIPT_CRITERIA.map(([k]) => `"${k}": {"score": 0, "note": ""}`).join(', ')}}, "risks": [{"at_pct": 0, "issue": "", "fix": ""}], "score": 0, "strengths": [""], "fixes": [""]}

SCRIPT:
${text}`,
    },
  ];
  const { data } = await geminiJson<Record<string, unknown>>(db, parts, { action: 'preflight_script', maxOutputTokens: 3000, meta: { title } });
  const c = (data.criteria ?? {}) as Record<string, { score?: number; note?: string }>;
  const h = (data.hook ?? {}) as { score?: number; verdict?: string; rewrite?: string };
  const criteria = SCRIPT_CRITERIA.map(([key, label]) => ({ key, label, score: clamp(c[key]?.score), note: str(c[key]?.note, 240) }));
  const hookScore = clamp(h.score);
  const avg = criteria.reduce((s, x) => s + x.score, 0) / criteria.length;
  return {
    // L'accroche compte double : c'est elle qui décide de la rétention des 30 premières secondes.
    score: Math.round((hookScore * 2 + avg * criteria.length) / (criteria.length + 2)),
    hook: { score: hookScore, verdict: str(h.verdict, 400), rewrite: str(h.rewrite, 900) },
    criteria,
    risks: Array.isArray(data.risks)
      ? (data.risks as { at_pct?: number; issue?: string; fix?: string }[]).slice(0, 6).map((r) => ({ at_pct: clamp(r.at_pct), issue: str(r.issue, 300), fix: str(r.fix, 300) }))
      : [],
    strengths: strs(data.strengths, 4),
    fixes: strs(data.fixes, 5),
    words,
    est_minutes: Math.round((words / 150) * 10) / 10,
  };
}
