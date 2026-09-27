import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Constants ────────────────────────────────────────────────────────
const PROMPT_VERSION = 'angles_v1';
const MODEL = 'claude-sonnet-4-20250514';
const MODEL_TAG = `sonnet-4-${PROMPT_VERSION}`;

// Sonnet pricing per million tokens
const INPUT_COST_PER_MTOK = 3.0;
const OUTPUT_COST_PER_MTOK = 15.0;
const EST_INPUT_TOKENS = 2000; // system + context
const EST_OUTPUT_TOKENS = 1200; // 5 angles JSON

// ── Types ────────────────────────────────────────────────────────────

export interface AngleInput {
  topicLabel: string;
  nicheName: string;
  rpmCoefficient: number;
  phase: number | null;
  frustrations: { text: string; label: string; requestedAngle: string | null; likeCount: number }[];
  competitors: { title: string; channelTitle: string }[];
}

export interface GeneratedAngle {
  title: string;
  hook: string;
  rationale: string;
}

export interface AngleGenerationResult {
  angles: GeneratedAngle[];
  model: string;
  costUSD: number;
}

// ── Interface ────────────────────────────────────────────────────────

export interface AngleGenerator {
  estimateCostUSD(): number;
  generate(input: AngleInput): Promise<AngleGenerationResult>;
}

// ── Implementation ───────────────────────────────────────────────────

function loadSystemPrompt(): string {
  return readFileSync(
    join(process.cwd(), 'lib/nlp/prompts/angles_v1.md'),
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

  return lines.join('\n');
}

export function estimateAngleCostUSD(): number {
  const inputCost = (EST_INPUT_TOKENS * INPUT_COST_PER_MTOK) / 1_000_000;
  const outputCost = (EST_OUTPUT_TOKENS * OUTPUT_COST_PER_MTOK) / 1_000_000;
  return inputCost + outputCost;
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
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Strip markdown fences if present
    let jsonText = content.text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

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
      };
    });

    // Compute actual cost from usage
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUSD =
      (inputTokens * INPUT_COST_PER_MTOK) / 1_000_000 +
      (outputTokens * OUTPUT_COST_PER_MTOK) / 1_000_000;

    return { angles, model: MODEL_TAG, costUSD };
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
        },
        {
          title: `${input.topicLabel} Explained Simply`,
          hook: 'This topic confuses everyone. Let me break it down.',
          rationale: 'Repond a la demande de clarification.',
        },
        {
          title: `Why ${input.topicLabel} Matters Now`,
          hook: 'The timing is perfect. Here is why.',
          rationale: 'Repond a la frustration de timing.',
        },
        {
          title: `${input.topicLabel}: What Experts Hide`,
          hook: 'Most guides skip this crucial step.',
          rationale: 'Repond a la frustration de contenu incomplet.',
        },
        {
          title: `Complete Guide to ${input.topicLabel}`,
          hook: 'Everything in one place. No fluff.',
          rationale: 'Repond a la demande de guide complet.',
        },
      ],
      model: 'fake',
      costUSD: 0,
    };
  }
}
