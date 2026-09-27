-- TubLyTI initial schema
-- 13 tables, pgvector, RLS on every table

create extension if not exists vector;

-- ============================================================
-- 1. niches
-- ============================================================
create table niches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  name text not null,
  category text not null,
  rpm_coefficient numeric not null default 1.0,
  owner_channel text,
  status text not null default 'active',
  created_at timestamptz default now()
);

alter table niches enable row level security;
create policy "workspace_isolation" on niches
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

-- ============================================================
-- 2. topics
-- ============================================================
create table topics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  niche_id uuid references niches(id) on delete cascade,
  label text not null,
  embedding vector(1024),
  phase smallint,
  status text not null default 'proposed',
  merged_into uuid references topics(id),
  created_at timestamptz default now()
);

alter table topics enable row level security;
create policy "workspace_isolation" on topics
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

-- ============================================================
-- 3. topic_queries
-- ============================================================
create table topic_queries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  topic_id uuid references topics(id) on delete cascade,
  source text not null,
  query_text text not null,
  priority smallint default 1
);

alter table topic_queries enable row level security;
create policy "workspace_isolation" on topic_queries
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

-- ============================================================
-- 4. channels
-- ============================================================
create table channels (
  id text primary key,
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  niche_id uuid references niches(id),
  title text,
  subscriber_count bigint,
  uploads_playlist_id text,
  last_checked_at timestamptz,
  created_at timestamptz default now()
);

alter table channels enable row level security;
create policy "workspace_isolation" on channels
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

-- ============================================================
-- 5. videos
-- ============================================================
create table videos (
  id text primary key,
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  channel_id text references channels(id),
  topic_id uuid references topics(id),
  title text,
  published_at timestamptz,
  duration_s integer,
  is_qualified boolean default false,
  title_embedding vector(1024),
  first_seen_at timestamptz default now()
);

alter table videos enable row level security;
create policy "workspace_isolation" on videos
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

-- ============================================================
-- 6. video_snapshots
-- ============================================================
create table video_snapshots (
  video_id text references videos(id) on delete cascade,
  captured_at timestamptz not null,
  views bigint,
  likes bigint,
  comments bigint,
  primary key (video_id, captured_at)
);

alter table video_snapshots enable row level security;
create policy "workspace_isolation" on video_snapshots
  for all using (
    exists (
      select 1 from videos v
      where v.id = video_snapshots.video_id
      and v.workspace_id = (auth.jwt() ->> 'workspace_id')::uuid
    )
  );

-- ============================================================
-- 7. comments
-- ============================================================
create table comments (
  id text primary key,
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  video_id text references videos(id) on delete cascade,
  text text not null,
  like_count integer default 0,
  published_at timestamptz
);

alter table comments enable row level security;
create policy "workspace_isolation" on comments
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

-- ============================================================
-- 8. comment_labels
-- ============================================================
create table comment_labels (
  comment_id text primary key references comments(id) on delete cascade,
  label text not null,
  requested_angle text,
  confidence numeric,
  model text,
  labeled_at timestamptz default now()
);

alter table comment_labels enable row level security;
create policy "workspace_isolation" on comment_labels
  for all using (
    exists (
      select 1 from comments c
      where c.id = comment_labels.comment_id
      and c.workspace_id = (auth.jwt() ->> 'workspace_id')::uuid
    )
  );

-- ============================================================
-- 9. trend_points
-- ============================================================
create table trend_points (
  topic_id uuid references topics(id) on delete cascade,
  source text not null,
  captured_at date not null,
  value numeric not null,
  primary key (topic_id, source, captured_at)
);

alter table trend_points enable row level security;
create policy "workspace_isolation" on trend_points
  for all using (
    exists (
      select 1 from topics t
      where t.id = trend_points.topic_id
      and t.workspace_id = (auth.jwt() ->> 'workspace_id')::uuid
    )
  );

-- ============================================================
-- 10. topic_scores
-- ============================================================
create table topic_scores (
  topic_id uuid references topics(id) on delete cascade,
  scored_at date not null,
  demand numeric,
  frustration numeric,
  supply_q numeric,
  monetization numeric,
  mgi numeric,
  phase smallint,
  primary key (topic_id, scored_at)
);

alter table topic_scores enable row level security;
create policy "workspace_isolation" on topic_scores
  for all using (
    exists (
      select 1 from topics t
      where t.id = topic_scores.topic_id
      and t.workspace_id = (auth.jwt() ->> 'workspace_id')::uuid
    )
  );

-- ============================================================
-- 11. angles
-- ============================================================
create table angles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  topic_id uuid references topics(id) on delete cascade,
  title text,
  hook text,
  rationale text,
  status text default 'idea',
  video_id text,
  created_at timestamptz default now()
);

alter table angles enable row level security;
create policy "workspace_isolation" on angles
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

-- ============================================================
-- 12. jobs
-- ============================================================
create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  started_at timestamptz default now(),
  finished_at timestamptz,
  quota_used integer default 0,
  items_processed integer default 0,
  error text
);

alter table jobs enable row level security;
create policy "allow_all_jobs" on jobs for all using (true);

-- ============================================================
-- 13. settings
-- ============================================================
create table settings (
  key text primary key,
  value jsonb not null
);

alter table settings enable row level security;
create policy "allow_all_settings" on settings for all using (true);

-- ============================================================
-- Indexes
-- ============================================================
create index idx_video_snapshots_captured_at on video_snapshots (captured_at);
create index idx_comments_video_id on comments (video_id);
create index idx_trend_points_topic_captured on trend_points (topic_id, captured_at);
-- ivfflat index requires rows to exist; created with empty lists for now
-- Will be rebuilt once data is loaded:
-- create index idx_topics_embedding on topics using ivfflat (embedding vector_cosine_ops);
