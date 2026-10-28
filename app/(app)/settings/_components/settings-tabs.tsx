'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SlidersHorizontal, Globe, Cpu } from 'lucide-react';
import { ScoringTab } from './scoring-tab';
import { NichesTab } from './niches-tab';
import { AiSpendTab } from './ai-spend-tab';
import type { ScoringSettings } from '@/lib/scoring/scoring-config';
import type { AlertRuleType } from '@/lib/alerts/evaluate';

const TABS = [
  { id: 'scoring', label: 'Scoring', icon: SlidersHorizontal },
  { id: 'niches', label: 'Niches', icon: Globe },
  { id: 'ai', label: 'Budget IA', icon: Cpu },
] as const;
// Accès API, alertes et apparence sont dans Réglages (propres à chaque compte, administrateur compris).

type TabId = (typeof TABS)[number]['id'];

interface TopTenItem {
  id: string;
  label: string;
  nicheName: string;
  phase: number;
  mgi: number;
}

interface NicheData {
  id: string;
  name: string;
  category: string;
  rpmCoefficient: number;
  ownerChannel: string;
  status: string;
  rpmLow: number | null;
  rpmHigh: number | null;
  rpmSource: string | null;
}

interface TokenData {
  id: string;
  name: string;
  tokenPrefix: string;
  permission: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface CollectionData {
  id: string;
  name: string;
  isDefault: boolean;
}

interface AlertRuleData {
  id: string;
  rule_type: AlertRuleType;
  params: Record<string, unknown>;
  label: string;
  instant_email: boolean;
  enabled: boolean;
  created_at: string;
}

export function SettingsTabs({
  scoring,
  defaultScoring,
  topTen,
  niches,
  tokens,
  collections,
  alertRules,
}: {
  scoring: ScoringSettings;
  defaultScoring: ScoringSettings;
  topTen: TopTenItem[];
  niches: NicheData[];
  tokens: TokenData[];
  collections: CollectionData[];
  alertRules: AlertRuleData[];
}) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<TabId>(
    tabParam && TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'scoring',
  );

  // Follow ?tab= changes (adjust state during render instead of an effect).
  const [prevTabParam, setPrevTabParam] = useState(tabParam);
  if (tabParam !== prevTabParam) {
    setPrevTabParam(tabParam);
    if (tabParam && TABS.some((t) => t.id === tabParam)) {
      setActiveTab(tabParam as TabId);
    }
  }

  return (
    <div className="space-y-6">
      {/* Tab nav */}
      <div className="flex gap-1 p-1 bg-muted/40 rounded-lg w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium transition-colors cursor-pointer ${
                active
                  ? 'bg-card text-foreground shadow-[0_1px_2px_rgba(20,24,34,0.08)]'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'scoring' && (
        <ScoringTab
          scoring={scoring}
          defaultScoring={defaultScoring}
          topTen={topTen}
        />
      )}
      {activeTab === 'niches' && <NichesTab niches={niches} />}
      {activeTab === 'ai' && <AiSpendTab />}

    </div>
  );
}
