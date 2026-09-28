-- P35: Title patterns extracted from outlier videos
-- Stores the dominant title formulas per niche

create table if not exists title_patterns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000000',
  niche_id uuid not null references niches(id) on delete cascade,
  formula text not null,            -- e.g. "question", "number_list", "how_i", "why", "comparison", "challenge"
  description text not null,        -- human-readable description of the formula
  examples text[] not null default '{}', -- actual titles that match
  frequency integer not null default 0,  -- how many outlier titles matched
  emotional_triggers text[] not null default '{}', -- e.g. ["curiosity", "fear", "urgency"]
  avg_length integer,               -- average title length in characters
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table title_patterns enable row level security;
create policy "workspace_title_patterns" on title_patterns
  for all using (workspace_id = '00000000-0000-0000-0000-000000000000');

create index idx_title_patterns_niche on title_patterns (niche_id, computed_at desc);
