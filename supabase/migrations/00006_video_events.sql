-- P31: Video activity events
-- Tracks title/thumbnail changes, new uploads, and view spikes

-- Add thumbnail_url to videos table
alter table videos add column if not exists thumbnail_url text;

-- video_events: unified event log
create table video_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  video_id text not null references videos(id) on delete cascade,
  event_type text not null, -- 'new_upload' | 'title_change' | 'thumbnail_change' | 'spike'
  old_value text,           -- previous title or thumbnail URL
  new_value text,           -- new title or thumbnail URL
  meta jsonb,               -- extra data (e.g. views_per_hour, median_vph for spike)
  created_at timestamptz not null default now()
);

alter table video_events enable row level security;
create policy "workspace_isolation" on video_events
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

create index idx_video_events_created on video_events (created_at desc);
create index idx_video_events_type on video_events (event_type, created_at desc);
create index idx_video_events_video on video_events (video_id);
