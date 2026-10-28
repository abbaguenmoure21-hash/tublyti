-- 00033 — Tâche de nuit : registre du quota YouTube, compactage des relevés, commentaires et sections déjà lus.
-- Non destructive et idempotente : on peut la rejouer. Le code de nuit fonctionne aussi tant qu'elle n'est pas appliquée
-- (replis journalisés).

-- ── Registre persistant du quota YouTube, par jour Pacifique et par étape ──────────────
create table if not exists public.yt_quota_ledger (
  day_pt date not null,
  task text not null,
  units integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day_pt, task)
);
alter table public.yt_quota_ledger enable row level security;
-- Lecture et écriture réservées au service (aucune policy = refus pour anon/authenticated).

create or replace function public.increment_yt_quota(p_day date, p_task text, p_units integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  insert into public.yt_quota_ledger (day_pt, task, units, updated_at)
  values (p_day, p_task, greatest(p_units, 0), now())
  on conflict (day_pt, task)
  do update set units = public.yt_quota_ledger.units + greatest(excluded.units, 0), updated_at = now();
  select coalesce(sum(units), 0) into v_total from public.yt_quota_ledger where day_pt = p_day;
  return v_total;
end;
$$;
revoke all on function public.increment_yt_quota(date, text, integer) from public, anon, authenticated;

-- ── Commentaires : date de dernière lecture (et pas date du dernier commentaire) ───────
alter table public.videos add column if not exists comments_fetched_at timestamptz;
alter table public.videos add column if not exists comments_disabled boolean not null default false;

-- ── Rattachement incrémental : une vidéo orpheline déjà comparée aux mêmes sujets n'est plus retestée ──
alter table public.videos add column if not exists attach_checked_at timestamptz;
create index if not exists idx_videos_orphans_unchecked
  on public.videos (id)
  where topic_id is null and title_embedding is not null and attach_checked_at is null;

-- ── Découverte par sections : date du dernier passage par chaîne ──────────────────────
alter table public.channels add column if not exists sections_scanned_at timestamptz;
create index if not exists idx_channels_sections_scanned on public.channels (sections_scanned_at nulls first);

-- ── Pics de vues : dédoublonnage par vidéo ───────────────────────────────────────────
create index if not exists idx_video_events_video_type_created
  on public.video_events (video_id, event_type, created_at desc);

-- ── Compactage des relevés anciens en semaines, en une transaction ───────────────────
-- video_snapshots n'a pas de colonne id : clé (video_id, captured_at).
-- Fusionne avec une semaine déjà agrégée (maximums + somme des comptes) puis supprime les relevés agrégés.
create or replace function public.aggregate_old_snapshots(p_cutoff timestamptz, p_limit integer default 5000)
returns table (weekly_rows integer, deleted_rows integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_weekly integer := 0;
  v_deleted integer := 0;
begin
  create temporary table if not exists _agg_batch (video_id text, captured_at timestamptz) on commit drop;
  truncate _agg_batch;

  insert into _agg_batch (video_id, captured_at)
  select s.video_id, s.captured_at
  from public.video_snapshots s
  where s.captured_at < p_cutoff
  order by s.captured_at
  limit greatest(p_limit, 1);

  with agg as (
    select s.video_id,
           (date_trunc('week', s.captured_at at time zone 'UTC'))::date as week_start,
           max(coalesce(s.views, 0)) as views,
           max(coalesce(s.likes, 0)) as likes,
           max(coalesce(s.comments, 0)) as comments,
           count(*)::integer as n
    from public.video_snapshots s
    join _agg_batch b on b.video_id = s.video_id and b.captured_at = s.captured_at
    group by 1, 2
  ), up as (
    insert into public.video_stats_weekly as w (video_id, week_start, views, likes, comments, snapshots_count)
    select video_id, week_start, views, likes, comments, n from agg
    on conflict (video_id, week_start) do update set
      views = greatest(w.views, excluded.views),
      likes = greatest(w.likes, excluded.likes),
      comments = greatest(w.comments, excluded.comments),
      snapshots_count = w.snapshots_count + excluded.snapshots_count
    returning 1
  )
  select count(*) into v_weekly from up;

  delete from public.video_snapshots s
  using _agg_batch b
  where b.video_id = s.video_id and b.captured_at = s.captured_at;
  get diagnostics v_deleted = row_count;

  return query select v_weekly, v_deleted;
end;
$$;
revoke all on function public.aggregate_old_snapshots(timestamptz, integer) from public, anon, authenticated;
