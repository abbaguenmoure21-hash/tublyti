-- ============================================================
-- 00018 — Espace client et console d'administration
-- Chaque utilisateur a ses propres chaînes, ses sujets ignorés et ses vidéos.
-- Les données d'analyse (niches, chaînes suivies, vidéos, sujets, scores)
-- restent communes : elles sont gérées depuis la console d'administration.
-- ============================================================

-- 1. Profils et rôles
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'client' check (role in ('client', 'admin')),
  display_name text,
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profil personnel" on public.profiles;
create policy "profil personnel" on public.profiles for select using (user_id = auth.uid());

-- Un profil « client » est créé à chaque nouvelle inscription.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profils pour les comptes déjà existants.
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;

-- 2. Les chaînes YouTube de chaque utilisateur (rattachées à une niche du catalogue)
create table if not exists public.user_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  niche_id uuid not null references public.niches(id) on delete restrict,
  title text not null,
  youtube_channel_id text,
  created_at timestamptz not null default now(),
  unique (user_id, niche_id)
);
create index if not exists user_channels_user_idx on public.user_channels (user_id);
alter table public.user_channels enable row level security;
drop policy if exists "chaînes personnelles" on public.user_channels;
create policy "chaînes personnelles" on public.user_channels for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. Niches suivies sans chaîne (exploration)
create table if not exists public.user_niches (
  user_id uuid not null references auth.users(id) on delete cascade,
  niche_id uuid not null references public.niches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, niche_id)
);
alter table public.user_niches enable row level security;
drop policy if exists "niches personnelles" on public.user_niches;
create policy "niches personnelles" on public.user_niches for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4. Sujets ignorés par chaque utilisateur (n'affecte pas les autres clients)
create table if not exists public.user_topic_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  state text not null check (state in ('ignored')),
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);
alter table public.user_topic_state enable row level security;
drop policy if exists "état personnel" on public.user_topic_state;
create policy "état personnel" on public.user_topic_state for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 5. Les vidéos (angles) appartiennent à un utilisateur
alter table public.angles add column if not exists user_id uuid references auth.users(id) on delete cascade;
create index if not exists angles_user_idx on public.angles (user_id, status);

-- 6. Fermer les accès ouverts à tous.
-- Ces tables avaient une règle « using (true) » : n'importe quel visiteur muni de la clé publique
-- pouvait les lire et les modifier. L'app y accède avec la clé de service, qui n'a pas besoin de ces règles.
drop policy if exists "allow_all_jobs" on public.jobs;
drop policy if exists "allow_all_settings" on public.settings;
drop policy if exists "service_all_search_results" on public.search_results;
drop policy if exists "Service role can manage video_stats_weekly" on public.video_stats_weekly;

-- ============================================================
-- Amorçage du compte administrateur (remplacer l'e-mail si besoin)
-- ============================================================
do $$
declare
  admin_email text := 'abbaguenmoure1@gmail.com';
  admin_id uuid;
begin
  select id into admin_id from auth.users where lower(email) = lower(admin_email) limit 1;
  if admin_id is null then
    raise notice 'Aucun compte trouvé pour %, rôle admin non attribué.', admin_email;
    return;
  end if;

  insert into public.profiles (user_id, role, display_name)
  values (admin_id, 'admin', 'ABBA')
  on conflict (user_id) do update set role = 'admin';

  -- Ses chaînes : celles indiquées dans le catalogue des niches.
  insert into public.user_channels (user_id, niche_id, title)
  select admin_id, n.id, trim(n.owner_channel)
  from public.niches n
  where n.owner_channel is not null and trim(n.owner_channel) <> ''
  on conflict (user_id, niche_id) do nothing;

  -- Ses vidéos déjà créées lui reviennent.
  update public.angles set user_id = admin_id
  where user_id is null and status in ('in_production', 'published');
end $$;
