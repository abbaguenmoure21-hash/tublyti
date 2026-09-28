-- Daily rate limiting for MCP API tools
create table api_usage (
  token_id uuid not null references api_tokens(id) on delete cascade,
  tool_name text not null,
  usage_date date not null default current_date,
  call_count integer not null default 0,
  primary key (token_id, tool_name, usage_date)
);

alter table api_usage enable row level security;
create policy "workspace_isolation" on api_usage
  for all using (
    exists (
      select 1 from api_tokens t
      where t.id = api_usage.token_id
      and t.workspace_id = (auth.jwt() ->> 'workspace_id')::uuid
    )
  );

create index idx_api_usage_date on api_usage (usage_date);
