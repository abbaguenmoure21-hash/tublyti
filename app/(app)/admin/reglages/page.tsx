import { Suspense } from 'react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { getScoringSettings, previewTopTenWithWeights } from '@/lib/actions/settings';
import { DEFAULT_SCORING } from '@/lib/scoring/scoring-config';
import { listApiTokens } from '@/lib/actions/api-tokens';
import { getCollections } from '@/lib/actions/collections';
import { getAlertRules } from '@/lib/actions/alerts';
import type { AlertRuleType } from '@/lib/alerts/evaluate';
import { SettingsTabs } from '../../settings/_components/settings-tabs';

export const metadata = { title: 'Niches et calcul · Console' };

/** Console d'admin : réglages qui s'appliquent à tous les clients (calcul du potentiel, niches, budget IA, accès API, alertes). */
export default async function AdminReglagesPage() {
  await requireAdmin();
  const db = createServiceClient();
  const [scoring, topTenRes, nichesRes, tokensRes, collectionsRes, alertRes, autoRes] = await Promise.all([
    getScoringSettings(),
    previewTopTenWithWeights(),
    db.from('niches').select('id, name, category, rpm_coefficient, owner_channel, status, rpm_low, rpm_high, rpm_source').order('name'),
    listApiTokens(),
    getCollections(),
    getAlertRules(),
    db.from('niches').select('id, name, category, rpm_low, rpm_high, auto_reason, created_at').eq('auto_created', true).order('created_at', { ascending: false }).limit(20),
  ]);
  // Avant la migration 00025, la colonne n'existe pas : aucune niche automatique.
  const autoNiches = (autoRes.error ? [] : autoRes.data ?? []) as { id: string; name: string; category: string; rpm_low: number | null; rpm_high: number | null; auto_reason: string | null }[];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Niches et calcul</h1>
        <p className="text-[15px] text-muted-foreground">Ces réglages s’appliquent à tous les clients.</p>
      </header>
      {autoNiches.length > 0 && (
        <section aria-labelledby="niches-auto" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="niches-auto" className="text-[17px] font-semibold">Niches créées automatiquement</h2>
            <p className="text-sm text-muted-foreground">
              Nées de chaînes candidates semblables qui ne ressemblaient à aucune niche. Vérifie le nom et la fourchette de RPM, estimée par l’IA, dans l’onglet Niches ci-dessous.
            </p>
          </div>
          <ul className="overflow-hidden rounded-2xl bg-card">
            {autoNiches.map((n) => (
              <li key={n.id} className="flex flex-col gap-0.5 border-b border-muted px-4 py-3 last:border-b-0">
                <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
                  {n.name}
                  <span className="text-xs font-normal text-muted-foreground">
                    {n.category} · RPM {n.rpm_low != null && n.rpm_high != null ? `${n.rpm_low}–${n.rpm_high} $ (estimation)` : 'à renseigner'}
                  </span>
                </span>
                {n.auto_reason && <span className="text-xs leading-snug text-muted-foreground">{n.auto_reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Suspense>
        <SettingsTabs
          scoring={scoring}
          defaultScoring={DEFAULT_SCORING}
          topTen={topTenRes.data ?? []}
          niches={(nichesRes.data ?? []).map((n: Record<string, unknown>) => ({
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
          tokens={(tokensRes.data ?? []).map((t: Record<string, unknown>) => ({
            id: t.id as string,
            name: t.name as string,
            tokenPrefix: t.token_prefix as string,
            permission: t.permission as string,
            lastUsedAt: (t.last_used_at as string) ?? null,
            createdAt: t.created_at as string,
            revokedAt: (t.revoked_at as string) ?? null,
          }))}
          collections={(collectionsRes.data ?? []).map((c: Record<string, unknown>) => ({
            id: c.id as string,
            name: c.name as string,
            isDefault: c.is_default as boolean,
          }))}
          alertRules={(alertRes.data ?? []).map((r: Record<string, unknown>) => ({
            id: r.id as string,
            rule_type: r.rule_type as AlertRuleType,
            params: (r.params as Record<string, unknown>) ?? {},
            label: r.label as string,
            instant_email: r.instant_email as boolean,
            enabled: r.enabled as boolean,
            created_at: r.created_at as string,
          }))}
        />
      </Suspense>
    </div>
  );
}
