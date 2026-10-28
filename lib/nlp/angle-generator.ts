import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

// ── Constants ────────────────────────────────────────────────────────
const PROMPT_VERSION = 'angles_v2';
// The former Sonnet 3.5 "latest" alias was retired by Anthropic: every call failed.
// Model is configurable; if it is unknown to the API (404), we fall back to
// Haiku 4.5, the model already used everywhere else in the codebase.
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 2_000;

function anglesModel(): string {
  return process.env.ANGLES_MODEL?.trim() || DEFAULT_MODEL;
}

/** Tag stored in ai_spend.model: real model + prompt version (AI_RULES 17). */
export function angleModelTag(model: string): string {
  return `${model.replace(/^claude-/, '')}-${PROMPT_VERSION}`;
}

/** Price per MTok (input / output) by model family. */
function pricing(model: string): { input: number; output: number } {
  if (/haiku/i.test(model)) return { input: 1.0, output: 5.0 };
  if (/opus/i.test(model)) return { input: 5.0, output: 25.0 };
  return { input: INPUT_COST_PER_MTOK, output: OUTPUT_COST_PER_MTOK };
}

const angleSchema = z.object({
  title: z.string().min(1),
  hook: z.string().min(1),
  rationale: z.string().default(''),
  formula: z.string().nullish(),
  frustration_resolved: z.string().nullish(),
});
const anglesSchema = z.array(angleSchema).min(5);

/** Error after a billed call (truncated / invalid answer): carries the cost to count. */
export class AngleGenerationError extends Error {
  constructor(
    message: string,
    public costUSD: number,
  ) {
    super(message);
    this.name = 'AngleGenerationError';
  }
}

import { estimateAngleCostUSD } from './angle-costs';

// Re-export for API route consumers
export { estimateAngleCostUSD } from './angle-costs';

// Sonnet pricing per million tokens
const INPUT_COST_PER_MTOK = 3.0;
const OUTPUT_COST_PER_MTOK = 15.0;

// ── Types ────────────────────────────────────────────────────────────

export interface TitlePattern {
  formula: string;
  description: string;
  examples: string[];
}

export interface AngleInput {
  topicLabel: string;
  nicheName: string;
  rpmCoefficient: number;
  phase: number | null;
  frustrations: { text: string; label: string; requestedAngle: string | null; likeCount: number }[];
  competitors: { title: string; channelTitle: string }[];
  titlePatterns?: TitlePattern[];
}

export interface GeneratedAngle {
  title: string;
  hook: string;
  rationale: string;
  formula: string | null;
  frustration_resolved: string | null;
}

export interface AngleGenerationResult {
  angles: GeneratedAngle[];
  model: string;
  costUSD: number;
  tokensIn: number;
  tokensOut: number;
}

// ── Interface ────────────────────────────────────────────────────────

export interface AngleGenerator {
  estimateCostUSD(): number;
  generate(input: AngleInput): Promise<AngleGenerationResult>;
}

// ── Implementation ───────────────────────────────────────────────────

function loadSystemPrompt(): string {
  return readFileSync(
    join(process.cwd(), 'lib/nlp/prompts/angles_v2.md'),
    'utf-8',
  );
}

function buildUserMessage(input: AngleInput): string {
  const phaseLabels: Record<number, string> = {
    0: 'Emergence',
    1: 'Viralite courte',
    2: 'Fenetre ideale',
    3: 'Saturation',
  };

  const lines: string[] = [
    `## Sujet : ${input.topicLabel}`,
    `Niche : ${input.nicheName} (RPM x${input.rpmCoefficient})`,
    `Phase : ${input.phase !== null ? phaseLabels[input.phase] ?? input.phase : 'inconnue'}`,
    '',
    '## Frustrations des spectateurs (triees par likes)',
  ];

  for (const f of input.frustrations.slice(0, 20)) {
    const angle = f.requestedAngle ? ` → ${f.requestedAngle}` : '';
    lines.push(`- [${f.likeCount} likes] ${f.text.slice(0, 200)}${angle}`);
  }

  lines.push('', '## Videos concurrentes qualifiees');
  for (const c of input.competitors.slice(0, 10)) {
    lines.push(`- ${c.title} (${c.channelTitle})`);
  }

  if (input.titlePatterns && input.titlePatterns.length > 0) {
    lines.push('', '## Formules de titres dominantes dans la niche');
    for (const p of input.titlePatterns) {
      lines.push(`- **${p.formula}** : ${p.description}`);
      if (p.examples.length > 0) {
        lines.push(`  Exemples : ${p.examples.slice(0, 3).join(' | ')}`);
      }
    }
  }

  return lines.join('\n');
}

export class ClaudeAngleGenerator implements AngleGenerator {
  estimateCostUSD(): number {
    return estimateAngleCostUSD();
  }

  async generate(input: AngleInput): Promise<AngleGenerationResult> {
    const anthropic = new Anthropic();
    const systemPrompt = loadSystemPrompt();
    const userMessage = buildUserMessage(input);

    let model = anglesModel();
    const ask = (m: string) =>
      anthropic.messages.create({
        model: m,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
    let response;
    try {
      response = await ask(model);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 404 || model === FALLBACK_MODEL) throw err;
      model = FALLBACK_MODEL;
      response = await ask(model);
    }

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const price = pricing(model);
    const costUSD = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;

    if (response.stop_reason === 'max_tokens') {
      throw new AngleGenerationError('La réponse de l’IA a été coupée avant la fin. Réessaie.', costUSD);
    }
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || !('text' in textBlock)) {
      throw new AngleGenerationError('Réponse de l’IA vide.', costUSD);
    }

    let jsonText = textBlock.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

    let raw: unknown;
    try {
      raw = JSON.parse(jsonText);
    } catch {
      throw new AngleGenerationError('Réponse de l’IA illisible. Réessaie.', costUSD);
    }
    const parsed = anglesSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AngleGenerationError('Réponse de l’IA incomplète (5 idées attendues). Réessaie.', costUSD);
    }

    const angles: GeneratedAngle[] = parsed.data.slice(0, 5).map((a) => ({
      title: a.title.slice(0, 60),
      hook: a.hook,
      rationale: a.rationale,
      formula: a.formula ? a.formula : null,
      frustration_resolved: a.frustration_resolved ? a.frustration_resolved : null,
    }));

    return { angles, model: angleModelTag(model), costUSD, tokensIn: inputTokens, tokensOut: outputTokens };
  }
}

export class FakeAngleGenerator implements AngleGenerator {
  estimateCostUSD(): number {
    return 0;
  }

  async generate(input: AngleInput): Promise<AngleGenerationResult> {
    return {
      angles: [
        {
          title: `The Truth About ${input.topicLabel}`,
          hook: 'Nobody talks about this. Here is what you need to know.',
          rationale: 'Repond a la frustration de manque de couverture.',
          formula: 'revelation',
          frustration_resolved: 'Manque de couverture du sujet',
        },
        {
          title: `${input.topicLabel} Explained Simply`,
          hook: 'This topic confuses everyone. Let me break it down.',
          rationale: 'Repond a la demande de clarification.',
          formula: 'how_i',
          frustration_resolved: 'Contenu trop complexe',
        },
        {
          title: `Why ${input.topicLabel} Matters Now`,
          hook: 'The timing is perfect. Here is why.',
          rationale: 'Repond a la frustration de timing.',
          formula: 'why',
          frustration_resolved: 'Timing et pertinence',
        },
        {
          title: `${input.topicLabel}: What Experts Hide`,
          hook: 'Most guides skip this crucial step.',
          rationale: 'Repond a la frustration de contenu incomplet.',
          formula: 'negative',
          frustration_resolved: 'Contenu incomplet des experts',
        },
        {
          title: `Complete Guide to ${input.topicLabel}`,
          hook: 'Everything in one place. No fluff.',
          rationale: 'Repond a la demande de guide complet.',
          formula: 'authority',
          frustration_resolved: 'Absence de guide complet',
        },
      ],
      model: 'fake',
      costUSD: 0,
      tokensIn: 0,
      tokensOut: 0,
    };
  }
}
