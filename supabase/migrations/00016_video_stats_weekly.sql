-- Weekly aggregation of video_snapshots to reduce storage
-- One row per video per ISO week, keeping max views/likes/comments

create table if not exists video_stats_weekly (
  video_id text not null references videos(id) on delete cascade,
  week_start date not null,  -- Monday of ISO week
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  snapshots_count integer not null default 1,
  primary key (video_id, week_start)
);

alter table video_stats_weekly enable row level security;

create policy "Service role can manage video_stats_weekly"
  on video_stats_weekly
  for all
  using (true)
  with check (true);

-- Index for quick lookups by week
create index if not exists idx_vsw_week on video_stats_weekly (week_start);
