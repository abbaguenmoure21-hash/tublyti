import type { SupabaseClient } from '@supabase/supabase-js';
import { parseDuration } from '../youtube/client';
import { reserveAiBudget, settleAiBudget } from '../ai/budget';

/**
 * Analyse du contenu d'une vidéo YouTube publique : image, audio et texte à l'écran.
 *
 * Gemini lit directement le lien YouTube (voie officielle de Google, sans téléchargement).
 * Une analyse par vidéo, gardée en cache dans `video_analyses` : jamais payée deux fois.
 * Coût indicatif : ~0,2 à 0,6 centime par minute de vidéo (basse résolution, Flash-Lite),
 * compté dans le budget IA mensuel (AI_BUDGET_USD).
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface TimedText {
  at_s: number;
  text: string;
}

export interface VideoAnalysis {
  summary: string;
  topic: string;
  language: string;
  audience: string;
  format: {
    style: string;
    visuals: string[];
    voice: string;
    voice_tone: string;
    music: string;
    on_screen_text: string;
    cuts_per_minute: number | null;
    pacing: string;
  };
  hook: {
    start_s: number;
    end_s: number;
    said: string;
    shown: string;
    promise: string;
    technique: string;
  };
  chapters: { start_s: number; end_s: number; title: string; summary: string }[];
  retention_devices: { at_s: number; technique: string; description: string }[];
  cta: TimedText[];
  packaging: { title_promise: string; delivered: string };
  why_it_works: string[];
  weaknesses: string[];
  how_to_adapt: string[];
  /** Seulement pour une vidéo de l'utilisateur avec la courbe de rétention : ce qui se passe aux décrochages. */
  retention_notes: { at_s: number; drop: string; what_happens: string; fix: string }[];
  transcript: TimedText[];
  /** true si la transcription ne couvre qu'une partie (vidéo longue). */
  transcript_partial: boolean;
}

export interface StoredAnalysis {
  videoId: string;
  status: 'running' | 'done' | 'error';
  title: string | null;
  channelTitle: string | null;
  durationS: number | null;
  model: string | null;
  analysis: VideoAnalysis | null;
  error: string | null;
  costUsd: number | null;
  createdAt: string;
  updatedAt: string;
}

export type AnalyzeFailure =
  | 'disabled'
  | 'invalid'
  | 'not_found'
  | 'private'
  | 'live'
  | 'too_long'
  | 'budget'
  | 'busy'
  | 'gemini';

export type AnalyzeResult = { ok: true; cached: boolean; row: StoredAnalysis } | { ok: false; reason: AnalyzeFailure; message: string };

/** Contexte facultatif : les plus fortes chutes de rétention d'une vidéo de l'utilisateur. */
export interface RetentionContext {
  /** at_ratio : position dans la vidéo (0 à 1) ; lost_pct : part des spectateurs perdus sur ce passage. */
  drops: { at_ratio: number; lost_pct: number }[];
  avg_view_pct?: number | null;
}

// ── Réglages ──────────────────────────────────────────────────────────

const DEFAULT_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
const PRICE_IN = Number(process.env.GEMINI_PRICE_IN_PER_MTOK ?? 0.5); // prudence : tarif audio
const PRICE_OUT = Number(process.env.GEMINI_PRICE_OUT_PER_MTOK ?? 2.5);
export const MAX_MIN = Number(process.env.VIDEO_ANALYSIS_MAX_MIN ?? 60);
const RUNNING_TIMEOUT_MS = 6 * 60_000;

export function videoAnalysisEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function models(): string[] {
  const env = (process.env.GEMINI_VIDEO_MODEL ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([...env, ...DEFAULT_MODELS])];
}

/** Images par seconde selon la durée : assez pour le montage, sans exploser le coût. */
function fpsFor(durationS: number): number {
  if (durationS <= 8 * 60) return 1;
  if (durationS <= 20 * 60) return 0.5;
  if (durationS <= 40 * 60) return 0.25;
  return 0.2;
}

/** Estimation avant appel (basse résolution ≈ 66 jetons par image + 32 jetons/s d'audio). */
export function estimateCostUsd(durationS: number): number {
  const tokensIn = durationS * (fpsFor(durationS) * 70 + 32) + 2_000;
  return (tokensIn * PRICE_IN + 8_000 * PRICE_OUT) / 1_000_000;
}

export function parseVideoId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(s) ? s : null;
}

function toStored(r: Record<string, unknown>): StoredAnalysis {
  return {
    videoId: r.video_id as string,
    status: r.status as StoredAnalysis['status'],
    title: (r.title as string | null) ?? null,
    channelTitle: (r.channel_title as string | null) ?? null,
    durationS: (r.duration_s as number | null) ?? null,
    model: (r.model as string | null) ?? null,
    analysis: (r.analysis as VideoAnalysis | null) ?? null,
    error: (r.error as string | null) ?? null,
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export async function getVideoAnalysis(db: SupabaseClient, videoId: string): Promise<StoredAnalysis | null> {
  const { data, error } = await db.from('video_analyses').select('*').eq('video_id', videoId).maybeSingle();
  if (error || !data) return null;
  return toStored(data as Record<string, unknown>);
}

// ── Métadonnées YouTube ───────────────────────────────────────────────

interface VideoMeta {
  title: string;
  channelTitle: string;
  description: string;
  durationS: number;
  privacy: string;
  live: string;
}

async function fetchMeta(videoId: string): Promise<VideoMeta | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${encodeURIComponent(videoId)}&key=${key}`,
    { cache: 'no-store' },
  ).catch(() => null);
  if (!res?.ok) return null;
  const j = (await res.json()) as {
    items?: {
      snippet?: { title?: string; channelTitle?: string; description?: string; liveBroadcastContent?: string };
      contentDetails?: { duration?: string };
      status?: { privacyStatus?: string };
    }[];
  };
  const it = j.items?.[0];
  if (!it) return null;
  return {
    title: it.snippet?.title ?? '',
    channelTitle: it.snippet?.channelTitle ?? '',
    description: (it.snippet?.description ?? '').slice(0, 1500),
    durationS: parseDuration(it.contentDetails?.duration ?? ''),
    privacy: it.status?.privacyStatus ?? 'public',
    live: it.snippet?.liveBroadcastContent ?? 'none',
  };
}

// ── Consigne ──────────────────────────────────────────────────────────

function buildPrompt(meta: VideoMeta, retention: RetentionContext | null): string {
  const fullTranscript = meta.durationS <= 25 * 60;
  const ret = retention?.drops.length
    ? `\nThe creator's YouTube Analytics show the biggest audience drops at: ${retention.drops
        .map((d) => `${Math.round(d.at_ratio * meta.durationS)}s (-${d.lost_pct}% of viewers)`)
        .join(', ')}${retention.avg_view_pct ? `; average view percentage ${retention.avg_view_pct}%` : ''}. For each drop, describe precisely what is said and shown at that moment, why viewers likely leave, and a concrete fix. Put this in "retention_notes".`
    : '\nNo retention data: return "retention_notes": [].';

  return `You are an expert YouTube content strategist. Watch AND listen to this whole video (visuals, voice, music, on-screen text) and reverse-engineer how it is made and why it performs.

Video title: ${meta.title}
Channel: ${meta.channelTitle}
Duration: ${meta.durationS} seconds
Description (excerpt): ${meta.description.replace(/\s+/g, ' ').slice(0, 800)}
${ret}

Write every text value in FRENCH (tutoiement, simple and concrete), except the transcript which stays in the video's original language. Times are integers in seconds from the start of the video. Be specific to THIS video: quote real lines, name real visuals. No generic advice.

${fullTranscript ? 'Transcript: the FULL spoken text, split into segments of about 20-40 seconds.' : 'Transcript: the video is long — transcribe only the first 5 minutes fully (segments of 20-40 s), then the key lines of each chapter. Set "transcript_partial": true.'}

Answer with JSON only, exactly this shape:
{
  "summary": "2-3 sentences: what the video says and its angle",
  "topic": "short topic",
  "language": "spoken language name in French",
  "audience": "who it targets",
  "format": {
    "style": "face caméra | voix off sans visage | animation | compilation | tutoriel écran | documentaire | autre (precise)",
    "visuals": ["list of visual ingredients actually used: stock footage, AI images, archive, motion graphics, B-roll filmed, screen recording, maps, memes..."],
    "voice": "voix humaine | voix de synthèse (IA) | pas de voix | mixte",
    "voice_tone": "tone and delivery",
    "music": "music and sound design",
    "on_screen_text": "how text/subtitles/captions are used",
    "cuts_per_minute": number or null,
    "pacing": "rythme du montage"
  },
  "hook": {"start_s": 0, "end_s": 30, "said": "what is said (quote)", "shown": "what is shown", "promise": "promise made to the viewer", "technique": "hook technique used"},
  "chapters": [{"start_s": 0, "end_s": 0, "title": "", "summary": ""}],
  "retention_devices": [{"at_s": 0, "technique": "open loop, teaser, pattern interrupt, question, cliffhanger...", "description": ""}],
  "cta": [{"at_s": 0, "text": "calls to action (subscribe, comment, link...)"}],
  "packaging": {"title_promise": "what the title/thumbnail promise", "delivered": "is the promise delivered, when"},
  "why_it_works": ["3-6 specific reasons"],
  "weaknesses": ["2-4 specific weaknesses"],
  "how_to_adapt": ["4-6 concrete things a creator can reuse for their own channel, without copying"],
  "retention_notes": [{"at_s": 0, "drop": "-x %", "what_happens": "", "fix": ""}],
  "transcript": [{"at_s": 0, "text": ""}],
  "transcript_partial": false
}`;
}

// ── Appel Gemini ──────────────────────────────────────────────────────

interface GeminiOut {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  finishReason?: string;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

class GeminiError extends Error {
  constructor(
    message: string,
    public kind: 'private' | 'model' | 'other',
  ) {
    super(message);
  }
}

async function callGemini(videoId: string, prompt: string, fps: number): Promise<GeminiOut> {
  const key = process.env.GEMINI_API_KEY as string;
  let lastErr: GeminiError | null = null;
  nextModel: for (const model of models()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(280_000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` }, videoMetadata: { fps } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            mediaResolution: 'MEDIA_RESOLUTION_LOW',
            temperature: 0.4,
            maxOutputTokens: 24_000,
            // JSON answers: no reasoning tokens eating the output budget (2.5 models only; the
            // newer ones use another setting and may reject this one).
            ...(/^gemini-2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
      }).catch((e: unknown) => {
        throw new GeminiError(e instanceof Error && e.name === 'TimeoutError' ? 'Gemini a mis trop de temps à répondre.' : 'Gemini injoignable.', 'other');
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; status?: string };
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      };

      if (!res.ok) {
        const msg = body.error?.message ?? `HTTP ${res.status}`;
        // Modèle inconnu ou retiré : on essaie le suivant.
        if (res.status === 404 || /not found|not supported|is not available/i.test(msg)) {
          lastErr = new GeminiError(`${model} : ${msg}`, 'model');
          continue nextModel;
        }
        if (/private|unlisted|permission|not accessible|cannot be accessed/i.test(msg)) throw new GeminiError(msg, 'private');
        // Overload / rate limit: one retry after a pause, then the next model (nothing billed).
        if (RETRYABLE.has(res.status)) {
          lastErr = new GeminiError(`${model} : ${msg}`, 'other');
          if (attempt === 0) await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        throw new GeminiError(msg, 'other');
      }

      const cand = body.candidates?.[0];
      const text = (cand?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('');
      const u = body.usageMetadata ?? {};
      // Returned even when empty or truncated: the caller records the (billed) spend first.
      return {
        text,
        model,
        tokensIn: u.promptTokenCount ?? 0,
        tokensOut: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        finishReason: cand?.finishReason,
      };
    }
  }
  throw lastErr ?? new GeminiError('Aucun modèle Gemini disponible.', 'model');
}

// ── Nettoyage de la réponse ───────────────────────────────────────────

const str = (v: unknown, max = 1200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};
const arr = <T>(v: unknown, map: (x: Record<string, unknown>) => T, max = 60): T[] =>
  Array.isArray(v) ? v.slice(0, max).map((x) => map((x ?? {}) as Record<string, unknown>)) : [];
const strs = (v: unknown, max = 10) => (Array.isArray(v) ? v.map((x) => str(x, 400)).filter(Boolean).slice(0, max) : []);

function parseAnalysis(raw: string): VideoAnalysis {
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const j = JSON.parse(text) as Record<string, unknown>;
  const f = (j.format ?? {}) as Record<string, unknown>;
  const h = (j.hook ?? {}) as Record<string, unknown>;
  const p = (j.packaging ?? {}) as Record<string, unknown>;
  const cpm = Number(f.cuts_per_minute);
  return {
    summary: str(j.summary),
    topic: str(j.topic, 200),
    language: str(j.language, 60),
    audience: str(j.audience, 300),
    format: {
      style: str(f.style, 200),
      visuals: strs(f.visuals, 12),
      voice: str(f.voice, 120),
      voice_tone: str(f.voice_tone, 300),
      music: str(f.music, 300),
      on_screen_text: str(f.on_screen_text, 300),
      cuts_per_minute: Number.isFinite(cpm) && cpm > 0 ? Math.round(cpm * 10) / 10 : null,
      pacing: str(f.pacing, 300),
    },
    hook: {
      start_s: num(h.start_s),
      end_s: num(h.end_s) || 30,
      said: str(h.said, 800),
      shown: str(h.shown, 600),
      promise: str(h.promise, 400),
      technique: str(h.technique, 300),
    },
    chapters: arr(j.chapters, (c) => ({ start_s: num(c.start_s), end_s: num(c.end_s), title: str(c.title, 160), summary: str(c.summary, 600) }), 40),
    retention_devices: arr(j.retention_devices, (c) => ({ at_s: num(c.at_s), technique: str(c.technique, 120), description: str(c.description, 400) }), 30),
    cta: arr(j.cta, (c) => ({ at_s: num(c.at_s), text: str(c.text, 300) }), 10),
    packaging: { title_promise: str(p.title_promise, 400), delivered: str(p.delivered, 400) },
    why_it_works: strs(j.why_it_works, 8),
    weaknesses: strs(j.weaknesses, 6),
    how_to_adapt: strs(j.how_to_adapt, 8),
    retention_notes: arr(
      j.retention_notes,
      (c) => ({ at_s: num(c.at_s), drop: str(c.drop, 40), what_happens: str(c.what_happens, 500), fix: str(c.fix, 400) }),
      8,
    ),
    transcript: arr(j.transcript, (c) => ({ at_s: num(c.at_s), text: str(c.text, 4000) }), 400).filter((t) => t.text),
    transcript_partial: Boolean(j.transcript_partial),
  };
}

// ── Point d'entrée ────────────────────────────────────────────────────

const MESSAGES: Record<AnalyzeFailure, string> = {
  disabled: 'L’analyse vidéo n’est pas encore activée : ajoute la clé GEMINI_API_KEY (Google AI Studio).',
  invalid: 'Lien ou ID de vidéo YouTube invalide.',
  not_found: 'Vidéo introuvable sur YouTube.',
  private: 'Seules les vidéos publiques peuvent être analysées (pas les privées ni les non répertoriées).',
  live: 'Les directs et les premières à venir ne peuvent pas être analysés.',
  too_long: `Vidéo trop longue : l’analyse est limitée à ${MAX_MIN} minutes.`,
  budget: 'Le budget IA du mois est atteint. L’analyse reprendra le mois prochain (ou augmente AI_BUDGET_USD).',
  busy: 'Cette vidéo est déjà en cours d’analyse. Reviens dans une minute.',
  gemini: 'L’analyse a échoué. Réessaie dans quelques minutes.',
};

function failure(reason: AnalyzeFailure, detail?: string): AnalyzeResult {
  return { ok: false, reason, message: detail ? `${MESSAGES[reason]} (${detail})` : MESSAGES[reason] };
}

export async function analyzeVideo(
  db: SupabaseClient,
  input: string,
  opts: { userId?: string | null; retention?: RetentionContext | null; force?: boolean } = {},
): Promise<AnalyzeResult> {
  const videoId = parseVideoId(input);
  if (!videoId) return failure('invalid');

  const existing = await getVideoAnalysis(db, videoId);
  const withRetention = Boolean(opts.retention?.drops.length);
  // Le cache sert, sauf si on apporte la rétention et que l'analyse en cache n'en a pas tenu compte.
  const needsRetention = withRetention && existing?.analysis && existing.analysis.retention_notes.length === 0;
  if (existing?.status === 'done' && existing.analysis && !opts.force && !needsRetention) return { ok: true, cached: true, row: existing };
  if (existing?.status === 'running' && Date.now() - new Date(existing.updatedAt).getTime() < RUNNING_TIMEOUT_MS) return failure('busy');

  if (!videoAnalysisEnabled()) return failure('disabled');

  const meta = await fetchMeta(videoId);
  if (!meta) return failure('not_found');
  if (meta.privacy !== 'public') return failure('private');
  if (meta.live === 'live' || meta.live === 'upcoming') return failure('live');
  if (meta.durationS > MAX_MIN * 60) return failure('too_long');

  // Budget IA du mois (partagé avec les autres usages de l'IA).
  // Reserved atomically: two simultaneous requests cannot both pass the cap.
  const reservation = await reserveAiBudget(db, estimateCostUsd(meta.durationS));
  if (!reservation.ok) return failure('budget');
  let settled = false;

  // Atomic lock: only one request can move the row to 'running' (two clicks = one paid analysis).
  const now = new Date().toISOString();
  const runningRow = {
    video_id: videoId,
    status: 'running',
    title: meta.title,
    channel_title: meta.channelTitle,
    duration_s: meta.durationS,
    error: null,
    requested_by: opts.userId ?? null,
    updated_at: now,
  };
  const staleBefore = new Date(Date.now() - RUNNING_TIMEOUT_MS).toISOString();
  const claim = existing
    ? await db
        .from('video_analyses')
        .update(runningRow)
        .eq('video_id', videoId)
        .or(`status.neq.running,updated_at.lt.${staleBefore}`)
        .select('video_id')
    : await db
        .from('video_analyses')
        .upsert({ ...runningRow, created_at: now }, { onConflict: 'video_id', ignoreDuplicates: true })
        .select('video_id');
  if (claim.error || !claim.data?.length) {
    await settleAiBudget(db, reservation, 0).catch(() => undefined);
    return failure('busy');
  }

  try {
    const out = await callGemini(videoId, buildPrompt(meta, opts.retention ?? null), fpsFor(meta.durationS));
    const cost = (out.tokensIn * PRICE_IN + out.tokensOut * PRICE_OUT) / 1_000_000;

    await db.from('ai_spend').insert({
      action: 'analyze_video',
      model: out.model,
      tokens_in: out.tokensIn,
      tokens_out: out.tokensOut,
      cost_usd: cost,
      meta: { video_id: videoId, topic_label: meta.title.slice(0, 120) },
    });
    // Billed from here on: never refunded, even if settling fails.
    settled = true;
    await settleAiBudget(db, reservation, cost).catch((e: unknown) =>
      console.error('[ai-budget] settle failed:', e instanceof Error ? e.message : e),
    );
    if (out.finishReason === 'MAX_TOKENS') throw new GeminiError('Réponse coupée (trop longue). Réessaie.', 'other');
    if (!out.text) throw new GeminiError(`Réponse vide (${out.finishReason ?? 'inconnue'}).`, 'other');
    // Parsed only after the spend is recorded: an unreadable answer is billed by Google too.
    const analysis = parseAnalysis(out.text);

    const { data: row } = await db
      .from('video_analyses')
      .update({
        status: 'done',
        model: out.model,
        analysis,
        tokens_in: out.tokensIn,
        tokens_out: out.tokensOut,
        cost_usd: cost,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('video_id', videoId)
      .select('*')
      .single();
    return { ok: true, cached: false, row: toStored(row as Record<string, unknown>) };
  } catch (e) {
    if (!settled) await settleAiBudget(db, reservation, 0).catch(() => undefined);
    const err = e as Error & { kind?: string };
    const reason: AnalyzeFailure = err.kind === 'private' ? 'private' : 'gemini';
    const detail = err instanceof SyntaxError ? 'réponse illisible' : err.message?.slice(0, 200);
    // Si une analyse valide existait déjà, on la garde.
    await db
      .from('video_analyses')
      .update(
        existing?.analysis
          ? { status: 'done', updated_at: new Date().toISOString() }
          : { status: 'error', error: detail ?? 'erreur', updated_at: new Date().toISOString() },
      )
      .eq('video_id', videoId);
    return failure(reason, reason === 'gemini' ? detail : undefined);
  }
}

export { analysisToMarkdown } from './analyze-markdown';

/** Les 3 plus fortes chutes d'une courbe de rétention (fenêtres de 5 %, hors tout début). */
export function retentionContextFrom(points: { at: number; watch: number }[]): RetentionContext | null {
  if (points.length < 10) return null;
  const drops: { at_ratio: number; lost: number }[] = [];
  for (let i = 5; i < points.length; i += 1) {
    const lost = points[i - 5].watch - points[i].watch;
    if (points[i].at > 0.04 && lost > 0.03) drops.push({ at_ratio: points[i - 5].at, lost });
  }
  drops.sort((a, b) => b.lost - a.lost);
  const picked: typeof drops = [];
  for (const d of drops) {
    if (picked.every((p) => Math.abs(p.at_ratio - d.at_ratio) > 0.08)) picked.push(d);
    if (picked.length === 3) break;
  }
  if (!picked.length) return null;
  const mean = points.reduce((s, p) => s + Math.min(1, p.watch), 0) / points.length;
  return {
    drops: picked.sort((a, b) => a.at_ratio - b.at_ratio).map((d) => ({ at_ratio: d.at_ratio, lost_pct: Math.round(d.lost * 100) })),
    avg_view_pct: Math.round(mean * 100),
  };
}
