# ARCHITECTURE.md — TubLyTI

## Vue d'ensemble

```
[YouTube Data API] [Reddit API] [HN Algolia] [SerpApi Trends]
        │               │            │             │
        └───────────────┴─────┬──────┴─────────────┘
                              ▼
              Cron 1 — collect (02:00 UTC)  → videos, video_snapshots, comments, trend_points
                              ▼
              Cron 2 — classify (03:00 UTC) → comment_labels (Claude Haiku, Batch API)
                              ▼
              Cron 3 — score (05:00 UTC)    → topics.phase, topic_scores, alertes Resend
                              ▼
              Supabase Postgres + pgvector  ←→  Next.js (UI + API routes + MCP)
```

Un seul dépôt, un seul déploiement Vercel. Aucun service à administrer.

## Structure des dossiers

```
app/
  (auth)/login/
  (app)/dashboard/                 matrice par niche
  (app)/topics/[id]/               fiche sujet
  (app)/channels/
  (app)/topics/review/             clusters à valider
  (app)/admin/jobs/
  api/cron/collect/route.ts
  api/cron/classify/route.ts
  api/cron/score/route.ts
  api/topics/[id]/angles/route.ts  génération d'angles (POST)
  api/mcp/route.ts                 serveur MCP (HTTP)
components/ui/                     shadcn
components/charts/                 matrice, courbes de signaux
lib/
  youtube/client.ts                YouTubeClient (fetch + comptage quota)
  youtube/quota.ts
  providers/trends.ts              TrendProvider (SerpApi, SearchApi)
  providers/social.ts              SocialProvider (Reddit, HN)
  providers/embeddings.ts          EmbeddingProvider
  nlp/classifier.ts                LLMClassifier (Haiku Batch)
  nlp/prompts/                     prompts versionnés
  scoring/mgi.ts                   calcul pur, testé
  scoring/phase.ts
  jobs/runner.ts                   journalisation, verrou, arrêt propre
  supabase/server.ts, client.ts
  email/alerts.ts
supabase/migrations/
tests/
vercel.json
```

## Schéma de base de données (Supabase / Postgres)

Toutes les tables ont `workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'` (workspace unique en V1) et RLS activée avec la politique `workspace_id = auth.jwt() ->> 'workspace_id'` (en V1, le JWT de l'unique utilisateur porte ce workspace).

```sql
create extension if not exists vector;

create table niches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  category text not null,               -- finance, psychology, ai_tools, ...
  rpm_coefficient numeric not null default 1.0,  -- 0.5 à 2.0
  owner_channel text,                    -- Wealth Decoded, ...
  status text not null default 'active',
  created_at timestamptz default now()
);

create table topics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  niche_id uuid references niches(id) on delete cascade,
  label text not null,
  embedding vector(1024),
  phase smallint,                        -- 0 émergence, 1 viralité courte, 2 fenêtre, 3 saturation
  status text not null default 'proposed', -- proposed, active, merged, rejected, in_production, published
  merged_into uuid references topics(id),
  created_at timestamptz default now()
);

create table topic_queries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  topic_id uuid references topics(id) on delete cascade,
  source text not null,                  -- youtube, trends, reddit, hn
  query_text text not null,
  priority smallint default 1
);

create table channels (
  id text primary key,                   -- YouTube channel id
  workspace_id uuid not null,
  niche_id uuid references niches(id),
  title text,
  subscriber_count bigint,
  uploads_playlist_id text,
  last_checked_at timestamptz,
  created_at timestamptz default now()
);

create table videos (
  id text primary key,                   -- YouTube video id
  workspace_id uuid not null,
  channel_id text references channels(id),
  topic_id uuid references topics(id),
  title text,
  published_at timestamptz,
  duration_s integer,
  is_qualified boolean default false,    -- durée ≥ 480 s, chaîne ≥ 10k, ratio vues/abonnés ≥ 0,2
  title_embedding vector(1024),
  first_seen_at timestamptz default now()
);

create table video_snapshots (
  video_id text references videos(id) on delete cascade,
  captured_at timestamptz not null,
  views bigint, likes bigint, comments bigint,
  primary key (video_id, captured_at)
);

create table comments (
  id text primary key,
  workspace_id uuid not null,
  video_id text references videos(id) on delete cascade,
  text text not null,
  like_count integer default 0,
  published_at timestamptz
);

create table comment_labels (
  comment_id text primary key references comments(id) on delete cascade,
  label text not null,                   -- no_one_explains, wish_video_on, stopped_too_early, searched_long, none
  requested_angle text,
  confidence numeric,
  model text,
  labeled_at timestamptz default now()
);

create table trend_points (
  topic_id uuid references topics(id) on delete cascade,
  source text not null,                  -- trends, reddit, hn, yt_views
  captured_at date not null,
  value numeric not null,
  primary key (topic_id, source, captured_at)
);

create table topic_scores (
  topic_id uuid references topics(id) on delete cascade,
  scored_at date not null,
  demand numeric, frustration numeric, supply_q numeric, monetization numeric,
  mgi numeric, phase smallint,
  primary key (topic_id, scored_at)
);

create table angles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  topic_id uuid references topics(id) on delete cascade,
  title text, hook text, rationale text,
  status text default 'idea',            -- idea, in_production, published
  video_id text,                         -- vidéo publiée, pour la calibration
  created_at timestamptz default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                    -- collect, classify, score
  started_at timestamptz default now(),
  finished_at timestamptz,
  quota_used integer default 0,
  items_processed integer default 0,
  error text
);

create table settings (
  key text primary key,                  -- mgi_weights, thresholds, ai_budget_usd
  value jsonb not null
);

create index on video_snapshots (captured_at);
create index on comments (video_id);
create index on trend_points (topic_id, captured_at);
create index on topics using ivfflat (embedding vector_cosine_ops);
```

## Règles de calcul

Voir `lib/scoring/mgi.ts`. Formule : `MGI = D × (1 + F) / (1 + O_q) × P`.

- `D` = moyenne pondérée (0,4 Trends 90 j, 0,3 vues/vidéo 30 j, 0,3 Reddit+HN 30 j), chaque signal converti en percentile parmi les sujets actifs du workspace. Poids dans `settings.mgi_weights`.
- `F` = part des commentaires du sujet avec label ≠ `none` et `confidence ≥ 0,7`.
- `O_q` = nombre de vidéos qualifiées publiées sur 180 j + 0,3 × nombre de vidéos anciennes (≥ 2 ans) faisant encore ≥ 10 000 vues/mois.
- `P` = `niches.rpm_coefficient`.
- Phase : 0 si Reddit/HN en hausse et O_q = 0 ; 2 si Trends +30 % sur 90 j et O_q ≤ 3 ; 3 si ≥ 5 vidéos qualifiées en 72 h ; sinon 1.

## Budget quota YouTube par nuit (cible < 3 000 unités)

| Opération | Coût | Volume | Unités |
| --- | --- | --- | --- |
| `channels.list` (50 ids) | 1 | 8 | 8 |
| `playlistItems.list` par chaîne | 1 | 400 | 400 |
| `videos.list` (50 ids) — snapshots | 1 | 40 | 40 |
| `commentThreads.list` (100 par page) | 1 | 1 000 | 1 000 |
| `search.list` | quota séparé | 100 | 100 appels |

Arrêt automatique à `YT_QUOTA_SOFT_LIMIT` (8 000). Reset à 00:00 heure du Pacifique (09:00 à Yaoundé en été, 08:00 en hiver).

## Intégrations et variables d'environnement

```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
YOUTUBE_API_KEY, YT_QUOTA_SOFT_LIMIT=8000
ANTHROPIC_API_KEY, AI_BUDGET_USD=30
VOYAGE_API_KEY, EMBEDDING_PROVIDER=voyage, EMBEDDING_MODEL=voyage-4-lite, EMBEDDING_BASE_URL=https://ai.mongodb.com/v1
SERPAPI_KEY, TREND_PROVIDER=serpapi
REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT
RESEND_API_KEY, ALERT_EMAIL
CRON_SECRET, MCP_TOKEN
```

## Sécurité

- RLS sur toutes les tables ; le client navigateur n'utilise que la clé anon ; la clé service role reste dans les routes serveur.
- Routes cron : refuser sans `Authorization: Bearer ${CRON_SECRET}`.
- Route MCP : refuser sans `MCP_TOKEN`.
- Validation Zod de toutes les entrées (ajout de chaîne, création de sujet, génération d'angles).
- Aucun secret côté client, aucun secret dans le dépôt.
- Rétention : commentaires purgés après 90 jours (les labels et angles sont conservés) ; snapshots hebdomadaires seulement au-delà de 90 jours.
