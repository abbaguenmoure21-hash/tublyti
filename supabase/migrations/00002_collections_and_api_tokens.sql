-- ============================================================
-- Collections (swipe file / bookmarks)
-- ============================================================
create table collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz default now()
);

alter table collections enable row level security;
create policy "workspace_isolation" on collections
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);

-- Seed default "Favoris" collection
insert into collections (workspace_id, name, is_default)
values ('00000000-0000-0000-0000-000000000001', 'Favoris', true);

create table collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references collections(id) on delete cascade,
  item_type text not null,  -- topic, video, channel, frustration, angle
  ref_id text not null,     -- UUID or YouTube ID depending on type
  note text,
  created_at timestamptz default now(),
  unique (collection_id, item_type, ref_id)
);

alter table collection_items enable row level security;
create policy "workspace_isolation" on collection_items
  for all using (
    exists (
      select 1 from collections c
      where c.id = collection_items.collection_id
      and c.workspace_id = (auth.jwt() ->> 'workspace_id')::uuid
    )
  );

-- ============================================================
-- API tokens
-- ============================================================
create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001',
  name text not null,
  token_hash text not null,       -- sha256 hash of the token
  token_prefix text not null,     -- first 8 chars for display
  permission text not null default 'read', -- read | readwrite
  last_used_at timestamptz,
  created_at timestamptz default now(),
  revoked_at timestamptz          -- null = active
);

alter table api_tokens enable row level security;
create policy "workspace_isolation" on api_tokens
  for all using (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);
