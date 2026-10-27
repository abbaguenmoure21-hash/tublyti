-- ============================================================
-- 00029 — Note avant publication + boucle d'apprentissage
-- 1. match_niche_videos : les vidéos de la niche aux titres les plus proches,
--    avec leur score de sur-performance (vues / vues habituelles de leur chaîne).
-- 2. preflight_checks : chaque évaluation (titres, miniature, script), sa prédiction,
--    puis le résultat réel une fois la vidéo publiée (pour recalibrer).
-- Non destructive : une fonction et une table nouvelles.
-- ============================================================

create or replace function public.match_niche_videos(
  query_embedding vector(1024),
  niche_ids uuid[],
  match_count int default 40
)
returns table (
  video_id text,
  title text,
  channel_id text,
  channel_title text,
  similarity float,
  score numeric,
  age_days integer
)
language sql
stable
as $$
  select v.id, v.title, v.channel_id, c.title, 1 - (v.title_embedding <=> query_embedding) as similarity, o.score, o.age_days
  from videos v
  join channels c on c.id = v.channel_id
  join video_outliers o on o.video_id = v.id
  where v.title_embedding is not null
    and c.niche_id = any(niche_ids)
  order by v.title_embedding <=> query_embedding
  limit match_count;
$$;

create table if not exists public.preflight_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_channel_id uuid references public.user_channels(id) on delete set null,
  niche_id uuid,
  title text not null,
  titles jsonb not null default '[]',        -- toutes les variantes évaluées
  has_thumbnail boolean not null default false,
  has_script boolean not null default false,
  result jsonb not null,                     -- notes, conseils, prédiction détaillée
  overall_score integer,
  predicted_multiple numeric,                -- vues attendues / vues habituelles de la chaîne
  predicted_p2x numeric,                     -- probabilité de dépasser 2× les vues habituelles
  video_id text,                             -- vidéo publiée rattachée (auto ou à la main)
  linked_at timestamptz,
  actual jsonb,                              -- { views_7d, baseline_7d, multiple_7d, measured_at }
  actual_multiple numeric,
  created_at timestamptz not null default now()
);
alter table public.preflight_checks enable row level security;
create index if not exists idx_preflight_user on public.preflight_checks(user_id, created_at desc);
create index if not exists idx_preflight_video on public.preflight_checks(video_id);
