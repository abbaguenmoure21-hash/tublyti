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
