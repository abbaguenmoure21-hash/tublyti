'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { DEFAULT_MGI_WEIGHTS, type MGIWeights } from '@/lib/scoring/mgi';
import { DEFAULT_SCORING } from '@/lib/scoring/scoring-config';
import type { ScoringSettings } from '@/lib/scoring/scoring-config';

export async function getScoringSettings(): Promise<ScoringSettings> {
  const db = createServiceClient();

  const { data: weightsRow } = await db
    .from('settings')
    .select('value')
    .eq('key', 'mgi_weights')
    .single();

  const { data: thresholdsRow } = await db
    .from('settings')
    .select('value')
    .eq('key', 'thresholds')
    .single();

  return {
    mgiWeights: weightsRow?.value ?? DEFAULT_MGI_WEIGHTS,
    thresholds: thresholdsRow?.value ?? DEFAULT_SCORING.thresholds,
  };
}

export async function saveScoringSettings(settings: ScoringSettings) {
  // Validate weights sum to ~1.0
  const { trends, ytViews, social } = settings.mgiWeights;
  const sum = trends + ytViews + social;
  if (Math.abs(sum - 1.0) > 0.01) {
    return { error: `La somme des poids doit être 1.0 (actuellement ${sum.toFixed(2)}).` };
  }

  if (trends < 0 || ytViews < 0 || social < 0) {
    return { error: 'Les poids ne peuvent pas être négatifs.' };
  }

  const db = createServiceClient();

  const { error: e1 } = await db
    .from('settings')
    .upsert({ key: 'mgi_weights', value: settings.mgiWeights });

  if (e1) return { error: e1.message };

  const { error: e2 } = await db
    .from('settings')
    .upsert({ key: 'thresholds', value: settings.thresholds });

  if (e2) return { error: e2.message };

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  return { success: true };
}

export async function previewTopTenWithWeights(weights: MGIWeights) {
  const db = createServiceClient();

  // Get all active topics with their latest scores
  const { data: topics } = await db
    .from('topics')
    .select('id, label, phase, niches(name)')
    .in('status', ['active', 'in_production'])
    .limit(200);

  if (!topics || topics.length === 0) return { data: [] };

  const topicIds = topics.map((t: Record<string, unknown>) => t.id as string);

  // Get latest scores
  const { data: scores } = await db
    .from('topic_scores')
    .select('topic_id, mgi, demand, supply_q, frustration, monetization')
    .in('topic_id', topicIds)
    .order('scored_at', { ascending: false });

  const latestScores: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();
  for (const s of scores ?? []) {
    if (!seen.has(s.topic_id)) {
      seen.add(s.topic_id);
      latestScores[s.topic_id] = s;
    }
  }

  // Build top 10 by current MGI
  const ranked = topics
    .map((t: Record<string, unknown>) => {
      const s = latestScores[t.id as string];
      return {
        id: t.id as string,
        label: t.label as string,
        nicheName: (t.niches as unknown as { name: string } | null)?.name ?? '',
        phase: (t.phase as number) ?? 0,
        mgi: s ? Number(s.mgi) : 0,
      };
    })
    .sort((a: { mgi: number }, b: { mgi: number }) => b.mgi - a.mgi)
    .slice(0, 10);

  return { data: ranked };
}

export async function updateNiche(
  nicheId: string,
  updates: {
    name?: string;
    category?: string;
    rpm_coefficient?: number;
    owner_channel?: string;
    rpm_low?: number;
    rpm_high?: number;
    rpm_source?: string;
  },
) {
  const db = createServiceClient();

  const { error } = await db
    .from('niches')
    .update(updates)
    .eq('id', nicheId);

  if (error) return { error: error.message };

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  return { success: true };
}
