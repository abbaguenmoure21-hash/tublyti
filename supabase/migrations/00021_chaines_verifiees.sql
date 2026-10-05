-- ============================================================
-- 00021 — Chaînes clients : ajout par lien YouTube et preuve de propriété
-- À exécuter après 00018 (et 00019). Aucune donnée supprimée.
-- ============================================================

-- 1. Plusieurs chaînes d'un même client peuvent partager une thématique.
alter table public.user_channels drop constraint if exists user_channels_user_id_niche_id_key;

-- 2. Informations lues sur YouTube au moment de l'ajout
alter table public.user_channels
  add column if not exists handle text,
  add column if not exists thumbnail_url text,
  add column if not exists subscriber_count bigint,
  add column if not exists video_count integer,
  add column if not exists view_count bigint,
  add column if not exists uploads_playlist_id text,
  add column if not exists subscribers_checked_at timestamptz,
  -- Preuve de propriété : code à placer dans la description de la chaîne
  add column if not exists verification_code text,
  add column if not exists verified_at timestamptz;

-- 3. Une chaîne YouTube n'apparaît qu'une fois par compte,
--    et ne peut être vérifiée que par un seul compte.
create unique index if not exists user_channels_user_youtube_uniq
  on public.user_channels (user_id, youtube_channel_id) where youtube_channel_id is not null;
create unique index if not exists user_channels_one_verified_owner
  on public.user_channels (youtube_channel_id) where verified_at is not null and youtube_channel_id is not null;

-- 4. Les chaînes déjà enregistrées (créées par 00018, sans lien YouTube) restent utilisables.
--    L'interface invite à les relier à leur chaîne YouTube.
update public.user_channels set verified_at = coalesce(verified_at, created_at)
  where youtube_channel_id is null or youtube_channel_id not like 'UC%';
