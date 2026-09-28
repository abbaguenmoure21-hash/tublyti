-- P32: Candidate channels + channel embeddings for similarity

-- ============================================================
-- 1. candidate_channels
-- ============================================================
create table candidate_channels (
  id text primary key,  -- YouTube channel ID
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  title text,
  subscriber_count bigint,
  median_views bigint,
  videos_per_month numeric,
  faceless_probability numeric,  -- 0.0 to 1.0
  faceless_reason text,
  discovered_via text,  -- 'search' | 'extension' | 'manual'
  source_topic_id uuid references topics(id) on delete set null,
  status text not null default 'pending',  -- 'pending' | 'followed' | 'ignored'
  created_at timestamptz not null default now()
);

alter table candidate_channels enable row level security;
create policy "workspace_isolation" on candidate_channels
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

create index idx_candidate_channels_status on candidate_channels(status);
create index idx_candidate_channels_created on candidate_channels(created_at desc);

-- ============================================================
-- 2. Add embedding column to channels for similarity search
-- ============================================================
alter table channels add column if not exists embedding vector(1024);
alter table channels add column if not exists status text not null default 'active';

-- Nearest neighbor function for channel similarity
create or replace function match_channels(
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  exclude_id text default null
)
returns table (
  id text,
  title text,
  subscriber_count bigint,
  niche_id uuid,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.title,
    c.subscriber_count,
    c.niche_id,
    1 - (c.embedding <=> query_embedding) as similarity
  from channels c
  where c.embedding is not null
    and c.status = 'active'
    and (exclude_id is null or c.id != exclude_id)
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;
