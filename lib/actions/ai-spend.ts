'use server';

import { assertAdmin } from '@/lib/auth/session';

import { createServiceClient } from '@/lib/supabase/server';
import { aiMonthKey as monthKey } from '@/lib/ai/budget';


export interface AiBudgetStatus {
  budgetLimitUSD: number;
  spentThisMonthUSD: number;
  remainingUSD: number;
}

export async function getAiBudgetStatus(): Promise<AiBudgetStatus> {
  const db = createServiceClient();
  const mk = monthKey();

  const { data: spendRow } = await db
    .from('settings')
    .select('value')
    .eq('key', mk)
    .single();

  const spentThisMonthUSD = typeof spendRow?.value === 'number' ? spendRow.value : 0;
  const budgetLimitUSD = parseFloat(process.env.AI_BUDGET_USD ?? '30');

  return {
    budgetLimitUSD,
    spentThisMonthUSD,
    remainingUSD: Math.max(0, budgetLimitUSD - spentThisMonthUSD),
  };
}

export interface AiSpendEntry {
  id: string;
  createdAt: string;
  action: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUSD: number;
  topicLabel: string | null;
}

export async function getAiSpendHistory(limit = 50): Promise<{ data: AiSpendEntry[] }> {
  await assertAdmin();
  const db = createServiceClient();

  const { data: rows } = await db
    .from('ai_spend')
    .select('id, created_at, action, model, tokens_in, tokens_out, cost_usd, meta')
    .order('created_at', { ascending: false })
    .limit(limit);

  const entries: AiSpendEntry[] = (rows ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    action: r.action as string,
    model: r.model as string,
    tokensIn: r.tokens_in as number,
    tokensOut: r.tokens_out as number,
    costUSD: Number(r.cost_usd),
    topicLabel: ((r.meta as Record<string, unknown> | null)?.topic_label as string) ?? null,
  }));

  return { data: entries };
}
