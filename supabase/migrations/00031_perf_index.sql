-- ============================================================
-- 00031 — Index de performance et fonctions de lecture
-- 1. Index sur les clés étrangères et les tris les plus lus (videos, topic_scores, jobs…).
-- 2. Index trigramme pour les recherches « contient » (sujets, chaînes, titres de vidéos).
-- 3. Fonctions de lecture qui agrègent côté base au lieu de ramener des milliers de lignes
--    (PostgREST coupe chaque réponse à 1 000 lignes, sans erreur).
-- Non destructive et rejouable : index « if not exists », fonctions nouvelles
-- (« create or replace »), aucune fonction existante modifiée, aucune donnée touchée.
-- À lancer hors fenêtre de la tâche de nuit : la construction des index sur `videos`
-- bloque les écritures de cette table le temps de l'opération.
-- ============================================================

create extension if not exists pg_trgm;  -- schéma « extensions » sur Supabase (dans le search_path)

-- Scores du jour (liste des sujets, carte, aujourd'hui, MCP) et date du dernier score
create index if not exists idx_topic_scores_scored_mgi on public.topic_scores (scored_at desc, mgi desc nulls last);

-- Clés étrangères les plus lues
create index if not exists idx_videos_topic_published   on public.videos (topic_id, published_at desc);
create index if not exists idx_videos_channel_published on public.videos (channel_id, published_at desc);
create index if not exists idx_channels_niche           on public.channels (niche_id);
create index if not exists idx_topics_niche_status      on public.topics (niche_id, status);
create index if not exists idx_angles_topic_created     on public.angles (topic_id, created_at desc);
create index if not exists idx_candidate_channels_niche_status on public.candidate_channels (niche_id, status);
create index if not exists idx_topic_queries_topic      on public.topic_queries (topic_id);

-- Recherches « contient » (ilike '%…%')
create index if not exists idx_topics_label_trgm   on public.topics   using gin (label gin_trgm_ops);
create index if not exists idx_channels_title_trgm on public.channels using gin (title gin_trgm_ops);
create index if not exists idx_videos_title_trgm   on public.videos   using gin (title gin_trgm_ops);

-- État des tâches (layout, aujourd'hui, admin)
create index if not exists idx_jobs_kind_finished on public.jobs (kind, finished_at desc);
create index if not exists idx_jobs_started       on public.jobs (started_at desc);

-- Dernières frustrations
create index if not exists idx_comment_labels_labeled on public.comment_labels (labeled_at desc) where label <> 'none';

-- Dernier relevé de chaque vidéo (une ligne par vidéo, via la clé primaire (video_id, captured_at))
create or replace function public.latest_video_snapshots(p_video_ids text[])
returns table (video_id text, captured_at timestamptz, views bigint, likes bigint, comments bigint)
language sql stable set search_path = public as $$
  select s.video_id, s.captured_at, s.views, s.likes, s.comments
  from unnest(p_video_ids) as ids(id)
  cross join lateral (
    select vs.video_id, vs.captured_at, vs.views, vs.likes, vs.comments
    from public.video_snapshots vs
    where vs.video_id = ids.id
    order by vs.captured_at desc
    limit 1
  ) s;
$$;

-- Nombre de vidéos par sujet (total, 90 derniers jours, chaînes distinctes sur 90 jours)
create or replace function public.topic_video_counts(p_topic_ids uuid[])
returns table (topic_id uuid, videos bigint, videos_90d bigint, channels_90d bigint)
language sql stable set search_path = public as $$
  select v.topic_id,
         count(*),
         count(*) filter (where v.published_at >= now() - interval '90 days'),
         count(distinct v.channel_id) filter (where v.published_at >= now() - interval '90 days')
  from public.videos v
  where v.topic_id = any(p_topic_ids)
  group by v.topic_id;
$$;

-- Impressions et clics (impressions × CTR) cumulés par vidéo d'une chaîne connectée
create or replace function public.video_reach_totals(p_user_channel_id uuid, p_video_ids text[])
returns table (video_id text, impressions bigint, clicks numeric)
language sql stable set search_path = public as $$
  select r.video_id, sum(r.impressions)::bigint, sum(r.impressions * coalesce(r.ctr, 0))
  from public.video_reach_daily r
  where r.user_channel_id = p_user_channel_id and r.video_id = any(p_video_ids)
  group by r.video_id;
$$;

-- Taux de base d'une niche (toutes ses vidéos scorées, sans échantillon arbitraire)
create or replace function public.niche_outlier_prior(p_niche_ids uuid[])
returns table (n bigint, log_mean double precision, p2x double precision, p10x double precision)
language sql stable set search_path = public as $$
  select count(*),
         avg(ln(least(100, greatest(0.05, o.score::double precision)))),
         avg((o.score >= 2)::int::double precision),
         avg((o.score >= 10)::int::double precision)
  from public.channels c
  join public.videos v on v.channel_id = c.id
  join public.video_outliers o on o.video_id = v.id
  where c.niche_id = any(p_niche_ids);
$$;

-- Vidéos qui ont le plus sur-performé dans la niche
create or replace function public.top_niche_outliers(
  p_niche_ids uuid[], p_since timestamptz, p_min_duration int default 240, p_min_score numeric default 3, p_limit int default 6
)
returns table (video_id text, title text, score numeric)
language sql stable set search_path = public as $$
  select v.id, v.title, o.score
  from public.channels c
  join public.videos v on v.channel_id = c.id
  join public.video_outliers o on o.video_id = v.id
  where c.niche_id = any(p_niche_ids)
    and v.published_at >= p_since
    and v.duration_s >= p_min_duration
    and o.score >= p_min_score
  order by o.score desc
  limit p_limit;
$$;

-- Voisins de titre avec date de publication (match_niche_videos de 00029 reste en place)
create or replace function public.match_niche_videos_v2(query_embedding vector(1024), niche_ids uuid[], match_count int default 40)
returns table (video_id text, title text, channel_id text, channel_title text, published_at timestamptz, similarity float, score numeric, age_days integer)
language sql stable set search_path = public, extensions as $$
  select v.id, v.title, v.channel_id, c.title, v.published_at,
         1 - (v.title_embedding <=> query_embedding), o.score, o.age_days
  from public.channels c
  join public.videos v on v.channel_id = c.id
  join public.video_outliers o on o.video_id = v.id
  where c.niche_id = any(niche_ids) and v.title_embedding is not null
  order by v.title_embedding <=> query_embedding
  limit match_count;
$$;

-- Même recherche à partir d'une vidéo du catalogue (le vecteur ne quitte pas la base)
create or replace function public.match_niche_videos_for_video(p_video_id text, match_count int default 80)
returns table (video_id text, title text, channel_id text, channel_title text, published_at timestamptz, similarity float, score numeric, age_days integer)
language sql stable set search_path = public, extensions as $$
  select m.*
  from public.videos src
  join public.channels sc on sc.id = src.channel_id
  cross join lateral public.match_niche_videos_v2(src.title_embedding, array[sc.niche_id], match_count) m
  where src.id = p_video_id and src.title_embedding is not null and sc.niche_id is not null;
$$;

-- Recherche sémantique de sujets, limitée aux niches demandées (null = toutes)
create or replace function public.match_topics(
  query_embedding vector(1024), match_threshold float, match_count int, p_niche_ids uuid[] default null
)
returns table (id uuid, label text, phase smallint, status text, niche_id uuid, similarity float)
language sql stable set search_path = public, extensions as $$
  select t.id, t.label, t.phase, t.status, t.niche_id, 1 - (t.embedding <=> query_embedding)
  from public.topics t
  where t.embedding is not null
    and t.status in ('active', 'in_production')
    and (p_niche_ids is null or t.niche_id = any(p_niche_ids))
    and 1 - (t.embedding <=> query_embedding) > match_threshold
  order by t.embedding <=> query_embedding
  limit match_count;
$$;

-- Statistiques à jour pour que le planificateur utilise les nouveaux index tout de suite
analyze public.videos;
analyze public.topic_scores;
analyze public.comment_labels;

-- Ces fonctions sont lues par le client « service ». Si la politique de sécurité (00032)
-- l'exige, révoquer EXECUTE aux rôles anon / authenticated.
