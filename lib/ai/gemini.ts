import type { SupabaseClient } from '@supabase/supabase-js';
import { aiBudgetLeft, reserveAiBudget, settleAiBudget } from './budget';

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
  const env = (process.env.GEMINI_VIDEO_MODEL ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([...env, ...DEFAULT_MODELS])];
}

export { aiBudgetLeft };

/** Raised before any network call when the monthly AI budget cannot cover the estimate. */
export class AiBudgetExceeded extends Error {
  constructor() {
    super(
      'Le budget IA du mois est atteint. Réessaie le mois prochain (ou augmente AI_BUDGET_USD).',
    );
    this.name = 'AiBudgetExceeded';
  }
}

/** Rough pre-call estimate: prompt tokens (text ≈ 4 chars/token, image ≈ 1 300 tokens) + max output. */
export function estimateGeminiCostUsd(parts: GeminiPart[], maxOutputTokens: number): number {
  let tokensIn = 0;
  for (const p of parts) {
    if ('text' in p) tokensIn += Math.ceil(p.text.length / 4);
    else if ('inlineData' in p) tokensIn += 1_300;
    else tokensIn += 1_300; // fileData: callers should pass opts.estUsd (video)
  }
  return (tokensIn * PRICE_IN + maxOutputTokens * PRICE_OUT) / 1_000_000;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

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
  opts: {
    action: string;
    maxOutputTokens?: number;
    temperature?: number;
    meta?: Record<string, unknown>;
    timeoutMs?: number;
    mediaResolution?: string;
    /** Pre-call cost estimate (USD). Defaults to estimateGeminiCostUsd(parts). */
    estUsd?: number;
  },
): Promise<GeminiJsonResult<T>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY manquante');
  const maxOut = opts.maxOutputTokens ?? 4000;

  // Budget check BEFORE any call (AI_RULES 8), reserved atomically so parallel calls cannot all pass.
  const reservation = await reserveAiBudget(
    db,
    opts.estUsd ?? estimateGeminiCostUsd(parts, maxOut),
  );
  if (!reservation.ok) throw new AiBudgetExceeded();
  let settled = false;
  try {
    let lastErr = 'Aucun modèle Gemini disponible.';
    for (const model of models()) {
      const out = await callModel(model);
      if (out.kind === 'next') {
        lastErr = out.err;
        continue;
      }
      // Count the spend as soon as Google answered, before parsing (a bad answer is still billed).
      await db
        .from('ai_spend')
        .insert({
          action: opts.action,
          model,
          tokens_in: out.tokensIn,
          tokens_out: out.tokensOut,
          cost_usd: out.costUsd,
          meta: opts.meta ?? null,
        });
      await settleAiBudget(db, reservation, out.costUsd);
      settled = true;
      if (out.finishReason === 'MAX_TOKENS')
        throw new Error('Réponse de Gemini coupée (trop longue). Réessaie.');
      if (!out.text) throw new Error('Réponse vide de Gemini.');
      return {
        data: JSON.parse(out.text) as T,
        model,
        tokensIn: out.tokensIn,
        tokensOut: out.tokensOut,
        costUsd: out.costUsd,
      };
    }
    throw new Error(lastErr);
  } finally {
    // Nothing billed (all models refused / network error): give the reservation back.
    if (!settled) await settleAiBudget(db, reservation, 0).catch(() => undefined);
  }

  type CallOut =
    | { kind: 'next'; err: string }
    | {
        kind: 'ok';
        text: string;
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
        finishReason?: string;
      };

  async function callModel(model: string): Promise<CallOut> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key! },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: opts.temperature ?? 0.3,
              maxOutputTokens: maxOut,
              ...(opts.mediaResolution ? { mediaResolution: opts.mediaResolution } : {}),
            },
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        candidates?: {
          content?: { parts?: { text?: string; thought?: boolean }[] };
          finishReason?: string;
        }[];
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
        };
      };
      if (!res.ok) {
        const msg = body.error?.message ?? `HTTP ${res.status}`;
        if (res.status === 404 || /not found|not supported|is not available/i.test(msg))
          return { kind: 'next', err: `${model} : ${msg}` };
        // Overload / rate limit: retry once after a short pause, then try the next model.
        if (RETRYABLE.has(res.status)) {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 2_000));
            continue;
          }
          return { kind: 'next', err: `${model} : ${msg}` };
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
      const u = body.usageMetadata ?? {};
      const tokensIn = u.promptTokenCount ?? 0;
      const tokensOut = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
      const costUsd = (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1_000_000;
      return {
        kind: 'ok',
        text,
        tokensIn,
        tokensOut,
        costUsd,
        finishReason: body.candidates?.[0]?.finishReason,
      };
    }
  }
}
