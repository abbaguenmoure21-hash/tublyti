/**
 * Classement d'une chaîne par l'IA (Claude Haiku) à partir de son profil complet :
 * description, mots-clés, catégories YouTube, tags fréquents, titres et descriptions des vidéos récentes.
 * L'IA choisit une niche existante ou propose une nouvelle niche (nom, catégorie, RPM habituel).
 *
 * Activé seulement avec CANDIDATE_AI_CLASSIFY=true (action IA payante, règle 24 d'AI_RULES).
 * Coût estimé : ~0,002 $ par chaîne (≈ 1 500 jetons lus, 100 écrits), dans la limite d'AI_BUDGET_USD par mois.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { reserveAiBudget, settleAiBudget } from '../ai/budget';
import { HAIKU_45, costUsd } from '../ai/pricing';

const MODEL = 'claude-haiku-4-5-20251001';

export interface AIClassification {
  nicheId: string | null;
  nicheName: string | null;
  newNiche: { name: string; category: string; rpmLow: number | null; rpmHigh: number | null } | null;
  confidence: number;
  reason: string;
}

export function aiClassifyEnabled(): boolean {
  return process.env.CANDIDATE_AI_CLASSIFY === 'true' && Boolean(process.env.ANTHROPIC_API_KEY);
}

let categoriesCache: string[] | null = null;

export async function classifyWithAI(
  db: SupabaseClient,
  profile: string,
  niches: { id: string; name: string }[],
  nearest: string[],
): Promise<AIClassification | null> {
  const reservation = await reserveAiBudget(db, 0.005);
  if (!reservation.ok) return null;
  let settled = false;

  if (!categoriesCache) {
    const { data } = await db.from('niches').select('category');
    categoriesCache = [...new Set(((data ?? []) as { category: string }[]).map((r) => r.category))];
  }

  try {
    const anthropic = new Anthropic();
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 250,
      messages: [
        {
          role: 'user',
          content: `You classify YouTube channels into content niches for a niche-research tool. Every niche is valid (news, cooking, gaming, meditation, any language or country): the goal is to put each channel in the niche that best describes WHAT its videos are about.

Channel profile:
${profile}

Existing niches:
${niches.map((n) => `- ${n.name}`).join('\n')}

Closest existing niches by text similarity (hint only, may be wrong): ${nearest.join(', ')}

Rules:
- Pick an existing niche ONLY if the channel's main subject truly belongs to it (a news channel is not "History", a cooking channel is not "Business").
- Otherwise propose a new niche: a 2-4 word English name in the same style as the existing ones, a category (one of: ${(categoriesCache ?? []).join(', ')} — or a new short snake_case word), and the typical RPM range in USD for this niche.
- Language and country do not matter for the niche; mention them in the reason only if useful.

Answer with JSON only:
{"niche": "<exact existing name or null>", "new_niche": {"name": "...", "category": "...", "rpm_low": 0, "rpm_high": 0} or null, "confidence": 0.0-1.0, "reason": "<one short sentence in French>"}`,
        },
      ],
    });
    const cost = costUsd(HAIKU_45, res.usage.input_tokens, res.usage.output_tokens);
    await db.from('ai_spend').insert({
      action: 'classify_channel_niche',
      model: 'haiku-4.5',
      tokens_in: res.usage.input_tokens,
      tokens_out: res.usage.output_tokens,
      cost_usd: cost,
    });
    await settleAiBudget(db, reservation, cost);
    settled = true;

    let text = res.content[0]?.type === 'text' ? res.content[0].text : '';
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const j = JSON.parse(text) as {
      niche?: string | null;
      new_niche?: { name?: string; category?: string; rpm_low?: number; rpm_high?: number } | null;
      confidence?: number;
      reason?: string;
    };
    const hit = j.niche ? niches.find((n) => n.name.toLowerCase() === String(j.niche).toLowerCase()) : null;
    const nn = !hit && j.new_niche?.name ? j.new_niche : null;
    const low = Number(nn?.rpm_low);
    const high = Number(nn?.rpm_high);
    return {
      nicheId: hit?.id ?? null,
      nicheName: hit?.name ?? null,
      newNiche: nn
        ? {
            name: String(nn.name).slice(0, 60),
            category: String(nn.category ?? 'other').toLowerCase().replace(/[^a-z_]/g, '_').slice(0, 30) || 'other',
            rpmLow: low > 0 && high >= low && high < 100 ? low : null,
            rpmHigh: low > 0 && high >= low && high < 100 ? high : null,
          }
        : null,
      confidence: Math.max(0, Math.min(1, Number(j.confidence ?? 0.5))),
      reason: String(j.reason ?? '').slice(0, 200),
    };
  } catch (e) {
    if (!settled) await settleAiBudget(db, reservation, 0).catch(() => undefined);
    console.error(`  classement IA : ${(e as Error).message}`);
    return null;
  }
}
