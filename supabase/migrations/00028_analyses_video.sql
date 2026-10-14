-- ============================================================
-- 00028 — Analyse du contenu des vidéos (image, audio, texte à l'écran)
-- Une analyse par vidéo YouTube publique, faite à la demande par Gemini
-- (lecture du lien YouTube, sans téléchargement) puis gardée en cache :
-- une même vidéo n'est jamais payée deux fois, tous comptes confondus.
-- Non destructive : nouvelle table uniquement.
-- ============================================================

create table if not exists public.video_analyses (
  video_id text primary key,                 -- ID YouTube (11 caractères)
  status text not null default 'running',    -- running | done | error
  title text,
  channel_title text,
  duration_s integer,
  model text,
  analysis jsonb,                            -- résultat structuré (accroche, structure, forme, transcription…)
  error text,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.video_analyses enable row level security;
create index if not exists idx_video_analyses_requested on public.video_analyses(requested_by, created_at desc);
