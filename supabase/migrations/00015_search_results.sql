-- search_results: discovered videos from YouTube search.list
-- NO foreign key to channels — these are external competitor videos.
-- O_q (supply qualified) is now computed from this table, not from videos.

create table if not exists search_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  topic_id uuid not null references topics(id) on delete cascade,
  video_id text not null,
  channel_id text not null,
  title text not null,
  views bigint,
  duration_s integer,
  published_at timestamptz,
  channel_title text,
  channel_subscribers bigint,
  rank integer,
  searched_at timestamptz not null default now(),
  unique (topic_id, video_id)
);

-- RLS
alter table search_results enable row level security;
create policy "service_all_search_results" on search_results
  for all using (true) with check (true);

-- Index for scoring queries
create index if not exists idx_search_results_topic on search_results (topic_id, searched_at desc);
create index if not exists idx_search_results_video on search_results (video_id);
