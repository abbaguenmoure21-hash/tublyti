-- P29: Credibility & AI spending
-- 1. Add confidence tracking to topic_scores
-- 2. Create ai_spend table
-- 3. Add RPM range columns to niches

-- ============================================================
-- topic_scores: confidence + confidence_reason
-- ============================================================
alter table topic_scores
  add column if not exists confidence text,         -- 'high', 'medium', 'low'
  add column if not exists confidence_reason text;   -- human-readable explanation

-- ============================================================
-- niches: RPM range instead of single coefficient
-- ============================================================
alter table niches
  add column if not exists rpm_low numeric,       -- e.g. 8
  add column if not exists rpm_high numeric,      -- e.g. 14
  add column if not exists rpm_source text;        -- e.g. 'YouTube Studio', 'estimation niche'

-- ============================================================
-- ai_spend: track every AI generation cost
-- ============================================================
create table ai_spend (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  created_at timestamptz not null default now(),
  action text not null,            -- 'generate_angles', 'classify_comments', 'title_analysis', 'niche_dossier'
  model text not null,             -- 'haiku-4.5', 'sonnet-4'
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric not null default 0,
  topic_id uuid references topics(id) on delete set null,
  meta jsonb                       -- additional context (e.g. topic label, niche)
);

alter table ai_spend enable row level security;
create policy "workspace_isolation" on ai_spend
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

create index idx_ai_spend_workspace_month on ai_spend (workspace_id, created_at);
create index idx_ai_spend_action on ai_spend (action);
