-- ============================================================
-- 00023 — Statistiques privées YouTube (YouTube Analytics) et revenus
-- Accès accordé par le client via Google. Le jeton est chiffré (AES-256-GCM)
-- avec TOKEN_ENCRYPTION_KEY, lisible uniquement par le serveur (clé de service).
-- ============================================================

create table if not exists public.user_channel_tokens (
  user_channel_id uuid primary key references public.user_channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  refresh_token_enc text not null,
  scopes text[] not null default '{}',
  granted_at timestamptz not null default now(),
  last_error text
);
alter table public.user_channel_tokens enable row level security;
-- Aucune règle d'accès : seul le serveur (clé de service) lit cette table.

create table if not exists public.channel_analytics (
  user_channel_id uuid not null references public.user_channels(id) on delete cascade,
  period text not null,               -- '7', '28', '90', '365'
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (user_channel_id, period)
);
alter table public.channel_analytics enable row level security;
