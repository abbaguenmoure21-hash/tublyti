import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Constants ────────────────────────────────────────────────────────
const PROMPT_VERSION = 'angles_v2';
const MODEL = 'claude-3-5-sonnet-latest';
const MODEL_TAG = `sonnet-5.5-${PROMPT_VERSION}`;

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

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || !('text' in textBlock)) {
      throw new Error('Unexpected response type from Claude: No text block found');
    }

    // Strip markdown fences if present
    let jsonText = textBlock.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    } else {
      // Fallback: strip leading ```json and trailing ``` manually if the response was truncated
      jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    // Attempt to fix truncated JSON by adding closing brackets if needed
    if (jsonText.trim().startsWith('[') && !jsonText.trim().endsWith(']')) {
      jsonText += ']';
    } else if (jsonText.trim().startsWith('[') && jsonText.trim().endsWith('}')) {
      jsonText += ']';
    }

    const parsed = JSON.parse(jsonText) as unknown[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Invalid response: expected array of angles');
    }

    const angles: GeneratedAngle[] = parsed.slice(0, 5).map((raw) => {
      const a = raw as Record<string, unknown>;
      return {
        title: String(a.title ?? '').slice(0, 60),
        hook: String(a.hook ?? ''),
        rationale: String(a.rationale ?? ''),
        formula: a.formula ? String(a.formula) : null,
        frustration_resolved: a.frustration_resolved ? String(a.frustration_resolved) : null,
      };
    });

    // Compute actual cost from usage
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUSD =
      (inputTokens * INPUT_COST_PER_MTOK) / 1_000_000 +
      (outputTokens * OUTPUT_COST_PER_MTOK) / 1_000_000;

    return { angles, model: MODEL_TAG, costUSD, tokensIn: inputTokens, tokensOut: outputTokens };
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
