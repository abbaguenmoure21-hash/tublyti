-- P30: Outlier score per video
-- Stores dated outlier scores computed from video_snapshots

create table video_outliers (
  video_id text not null references videos(id) on delete cascade,
  score numeric not null,          -- views / median baseline
  baseline numeric not null,       -- median views of 10 previous videos
  age_days integer not null,       -- age of the video when measured
  method text not null,            -- 'same_age' or 'approximate'
  computed_at timestamptz not null default now(),
  primary key (video_id)
);

alter table video_outliers enable row level security;
create policy "workspace_isolation" on video_outliers
  for all using (
    exists (
      select 1 from videos v
      where v.id = video_outliers.video_id
      and v.workspace_id = (auth.jwt() ->> 'workspace_id')::uuid
    )
  );

create index idx_video_outliers_score on video_outliers (score desc);
