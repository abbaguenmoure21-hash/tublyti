import { Suspense } from 'react';
import { createServiceClient } from '@/lib/supabase/server';
import { getScoringSettings, previewTopTenWithWeights } from '@/lib/actions/settings';
import { DEFAULT_SCORING } from '@/lib/scoring/scoring-config';
import { listApiTokens } from '@/lib/actions/api-tokens';
import { getCollections } from '@/lib/actions/collections';
import { getAlertRules } from '@/lib/actions/alerts';
import { SettingsTabs } from './_components/settings-tabs';

export const metadata = { title: 'Réglages' };

export default async function SettingsPage() {
  const db = createServiceClient();

  // Scoring settings
  const scoring = await getScoringSettings();

  // Preview top 10 with current weights
  const { data: topTen } = await previewTopTenWithWeights(scoring.mgiWeights);

  // Niches
  const { data: niches } = await db
    .from('niches')
    .select('id, name, category, rpm_coefficient, owner_channel, status, rpm_low, rpm_high, rpm_source')
    .order('name');

  // API tokens
  const { data: tokens } = await listApiTokens();

  // Collections
  const { data: collections } = await getCollections();

  // Alert rules
  const { data: alertRules } = await getAlertRules();

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="h-[64px] shrink-0 flex items-center px-8 border-b border-[--glass-border] bg-[--bg-surface-1]/50 backdrop-blur-xl">
        <h1 className="text-[20px] font-semibold text-foreground tracking-tight">Réglages</h1>
      </header>

      <div className="flex-1 p-6 md:p-8 max-w-4xl">
        <Suspense>
        <SettingsTabs
          scoring={scoring}
          defaultScoring={DEFAULT_SCORING}
          topTen={topTen ?? []}
          niches={(niches ?? []).map((n: Record<string, unknown>) => ({
            id: n.id as string,
            name: n.name as string,
            category: n.category as string,
            rpmCoefficient: Number(n.rpm_coefficient),
            ownerChannel: (n.owner_channel as string) ?? '',
            status: n.status as string,
            rpmLow: n.rpm_low != null ? Number(n.rpm_low) : null,
            rpmHigh: n.rpm_high != null ? Number(n.rpm_high) : null,
            rpmSource: (n.rpm_source as string) ?? null,
          }))}
          tokens={(tokens ?? []).map((t: Record<string, unknown>) => ({
            id: t.id as string,
            name: t.name as string,
            tokenPrefix: t.token_prefix as string,
            permission: t.permission as string,
            lastUsedAt: (t.last_used_at as string) ?? null,
            createdAt: t.created_at as string,
            revokedAt: (t.revoked_at as string) ?? null,
          }))}
          collections={(collections ?? []).map((c: Record<string, unknown>) => ({
            id: c.id as string,
            name: c.name as string,
            isDefault: c.is_default as boolean,
          }))}
          alertRules={(alertRules ?? []).map((r: Record<string, unknown>) => ({
            id: r.id as string,
            rule_type: r.rule_type as string,
            params: (r.params as Record<string, unknown>) ?? {},
            label: r.label as string,
            instant_email: r.instant_email as boolean,
            enabled: r.enabled as boolean,
            created_at: r.created_at as string,
          }))}
        />
        </Suspense>
      </div>
    </div>
  );
}
