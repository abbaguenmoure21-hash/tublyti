import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Appel générique à Gemini (texte + images), réponse JSON.
 * Même liste de modèles et même repli automatique que l'analyse vidéo.
 * Les dépenses sont comptées dans le budget IA du mois (AI_BUDGET_USD).
 */

const DEFAULT_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
const PRICE_IN = Number(process.env.GEMINI_PRICE_IN_PER_MTOK ?? 0.5);
const PRICE_OUT = Number(process.env.GEMINI_PRICE_OUT_PER_MTOK ?? 2.5);

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType: string } };

export function geminiEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function models(): string[] {
  const env = (process.env.GEMINI_VIDEO_MODEL ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([...env, ...DEFAULT_MODELS])];
}

function monthKey(): string {
  const d = new Date();
  return `ai_spend_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function aiBudgetLeft(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('settings').select('value').eq('key', monthKey()).maybeSingle();
  const spent = typeof data?.value === 'number' ? data.value : 0;
  return Number(process.env.AI_BUDGET_USD ?? 30) - spent;
}

export interface GeminiJsonResult<T> {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/** Envoie les parties à Gemini et renvoie le JSON de la réponse (lève une erreur si illisible). */
export async function geminiJson<T>(
  db: SupabaseClient,
  parts: GeminiPart[],
  opts: { action: string; maxOutputTokens?: number; temperature?: number; meta?: Record<string, unknown>; timeoutMs?: number; mediaResolution?: string },
): Promise<GeminiJsonResult<T>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY manquante');
  let lastErr = 'Aucun modèle Gemini disponible.';
  for (const model of models()) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: opts.temperature ?? 0.3,
          maxOutputTokens: opts.maxOutputTokens ?? 4000,
          ...(opts.mediaResolution ? { mediaResolution: opts.mediaResolution } : {}),
        },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    if (!res.ok) {
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 404 || /not found|not supported|is not available/i.test(msg)) {
        lastErr = `${model} : ${msg}`;
        continue;
      }
      throw new Error(msg);
    }
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    if (!text) throw new Error('Réponse vide de Gemini.');
    const u = body.usageMetadata ?? {};
    const tokensIn = u.promptTokenCount ?? 0;
    const tokensOut = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    const costUsd = (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1_000_000;

    await db.from('ai_spend').insert({ action: opts.action, model, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: costUsd, meta: opts.meta ?? null });
    const { data: row } = await db.from('settings').select('value').eq('key', monthKey()).maybeSingle();
    const spent = typeof row?.value === 'number' ? row.value : 0;
    await db.from('settings').upsert({ key: monthKey(), value: spent + costUsd });

    return { data: JSON.parse(text) as T, model, tokensIn, tokensOut, costUsd };
  }
  throw new Error(lastErr);
}
