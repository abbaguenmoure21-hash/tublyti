-- ============================================================
-- 00027 — Impressions et taux de clic des miniatures (YouTube Reporting API)
-- Rapport quotidien « channel_reach_basic_a1 » : une tâche par chaîne connectée,
-- fichiers déposés chaque jour par YouTube (30 jours rattrapés à la création).
-- Non destructive : nouvelles tables uniquement.
-- ============================================================

create table if not exists public.reporting_jobs (
  user_channel_id uuid primary key references public.user_channels(id) on delete cascade,
  job_id text not null,
  report_type text not null default 'channel_reach_basic_a1',
  created_at timestamptz not null default now(),
  last_report_created timestamptz,          -- createTime du dernier fichier importé
  last_sync_at timestamptz,
  last_error text
);
alter table public.reporting_jobs enable row level security;

create table if not exists public.video_reach_daily (
  user_channel_id uuid not null references public.user_channels(id) on delete cascade,
  video_id text not null,
  day date not null,
  impressions bigint not null default 0,
  ctr numeric,                               -- taux de clic, en fraction (0,054 = 5,4 %)
  primary key (user_channel_id, video_id, day)
);
alter table public.video_reach_daily enable row level security;
create index if not exists idx_video_reach_video on public.video_reach_daily(video_id);
