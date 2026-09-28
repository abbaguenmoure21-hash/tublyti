-- P34: Alert rules and events
-- Types: phase_change (niche topic hits phase 2), collection_phase_change,
-- video_outlier (video > N× on channel < K subs), window_closing (burn-down)

create table if not exists alert_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000000',
  rule_type text not null check (rule_type in (
    'phase_change',           -- un sujet de la niche X passe en phase 2
    'collection_phase_change', -- un sujet de ma collection change de phase
    'video_outlier',           -- vidéo > N× sur chaîne < K abonnés
    'window_closing'           -- fenêtre qui se ferme (burn-down)
  )),
  -- Rule parameters (JSON)
  -- phase_change: { "niche_id": "...", "target_phase": 2 }
  -- collection_phase_change: { "collection_id": "..." }
  -- video_outlier: { "view_multiplier": 5, "max_subscribers": 50000 }
  -- window_closing: { "min_qualified_72h": 5 }
  params jsonb not null default '{}',
  label text not null,                     -- user-facing description
  instant_email boolean not null default false, -- send immediately vs digest
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table alert_rules enable row level security;
create policy "workspace_alert_rules" on alert_rules
  for all using (workspace_id = '00000000-0000-0000-0000-000000000000');

create table if not exists alert_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000000',
  rule_id uuid not null references alert_rules(id) on delete cascade,
  rule_type text not null,
  payload jsonb not null default '{}',      -- details about what triggered
  read boolean not null default false,
  emailed boolean not null default false,
  created_at timestamptz not null default now()
);

alter table alert_events enable row level security;
create policy "workspace_alert_events" on alert_events
  for all using (workspace_id = '00000000-0000-0000-0000-000000000000');

-- Index for badge count (unread)
create index idx_alert_events_unread on alert_events (workspace_id, read) where read = false;
-- Index for digest grouping
create index idx_alert_events_digest on alert_events (workspace_id, emailed, created_at) where emailed = false;
