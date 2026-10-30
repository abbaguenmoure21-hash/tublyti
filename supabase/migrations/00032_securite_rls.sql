-- 00032 — Security: per-account tables become read-only for the public (anon) key.
--
-- The Supabase URL and anon key are public (NEXT_PUBLIC_*). With the 00018 "for all"
-- policies, a signed-in client could insert/update its own rows directly from the browser,
-- e.g. set user_channels.verified_at on any YouTube channel and skip the ownership check.
-- Every legitimate write already goes through server actions / routes using the service
-- role key (which bypasses RLS), so clients only need to READ their own rows.
--
-- Non destructive: no data is touched, only policies and grants. Idempotent.

-- user_channels: read own rows only
drop policy if exists "chaînes personnelles" on public.user_channels;
drop policy if exists "chaînes personnelles (lecture)" on public.user_channels;
create policy "chaînes personnelles (lecture)" on public.user_channels
  for select using (user_id = auth.uid());

-- user_niches: read own rows only
drop policy if exists "niches personnelles" on public.user_niches;
drop policy if exists "niches personnelles (lecture)" on public.user_niches;
create policy "niches personnelles (lecture)" on public.user_niches
  for select using (user_id = auth.uid());

-- user_topic_state: read own rows only
drop policy if exists "état personnel" on public.user_topic_state;
drop policy if exists "état personnel (lecture)" on public.user_topic_state;
create policy "état personnel (lecture)" on public.user_topic_state
  for select using (user_id = auth.uid());

-- Job lock RPC: server only (nightly job / cron routes use the service role).
revoke execute on function public.acquire_job_lock(text, text, text) from public, anon, authenticated;
grant execute on function public.acquire_job_lock(text, text, text) to service_role;

-- Per-account usage caps for server actions that spend the shared YouTube quota or paid APIs
-- (channel lookup, link saturation, video upload, publish check). Server only: RLS on, no policy.
create table if not exists public.user_action_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  bucket text not null, -- '2026-10-28' (daily) or '2026-10-28T14' (hourly), UTC
  call_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, action, bucket)
);
alter table public.user_action_usage enable row level security;

-- Atomic increment within the cap. Returns the new count, or null when the cap is reached.
create or replace function public.consume_user_quota(
  p_user_id uuid,
  p_action text,
  p_bucket text,
  p_limit integer
) returns integer
language sql
as $$
  insert into public.user_action_usage as u (user_id, action, bucket, call_count)
  values (p_user_id, p_action, p_bucket, 1)
  on conflict (user_id, action, bucket) do update
    set call_count = u.call_count + 1, updated_at = now()
    where u.call_count < p_limit
  returning call_count;
$$;
revoke execute on function public.consume_user_quota(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.consume_user_quota(uuid, text, text, integer) to service_role;
