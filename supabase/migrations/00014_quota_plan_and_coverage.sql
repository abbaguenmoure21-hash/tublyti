-- P33: Quota budget system + coverage tracking
-- 1. Default quota_plan in settings
-- 2. Add niche coverage columns
-- 3. Auto-triage thresholds for candidate_channels

-- ============================================================
-- Default quota plan (can be overridden via settings page)
-- ============================================================
insert into settings (key, value)
values ('quota_plan', '{"tracking": 3500, "discovery": 3000, "comments": 2000, "reserve": 1500}'::jsonb)
on conflict (key) do nothing;

-- ============================================================
-- candidate_channels: add auto-triage columns if missing
-- ============================================================
do $$
begin
  alter table candidate_channels
    add column if not exists embedding_similarity numeric,
    add column if not exists auto_decision text,           -- 'accepted', 'rejected', null (=manual)
    add column if not exists auto_reason text,
    add column if not exists discovered_via text default 'search',  -- search, channel_section, trending, comment_author, manual
    add column if not exists long_video_count integer,
    add column if not exists niche_id uuid references niches(id);
exception when undefined_table then
  raise notice 'candidate_channels not yet created — skipping';
end;
$$;

-- ============================================================
-- niches: coverage tracking columns
-- ============================================================
alter table niches
  add column if not exists target_channels integer default 1500,
  add column if not exists coverage_sufficient boolean default false;
