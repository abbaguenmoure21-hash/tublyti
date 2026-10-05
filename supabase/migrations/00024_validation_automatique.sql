-- ============================================================
-- 00024 — Validation automatique
-- 1. Chaînes candidates : niche détectée automatiquement à partir des titres de leurs dernières vidéos.
-- 2. Sujets proposés : trace de la validation (automatique ou par l'administrateur).
-- Non destructive : uniquement des ajouts de colonnes.
-- ============================================================

alter table public.candidate_channels
  add column if not exists recent_titles text[],
  add column if not exists embedding vector(1024),
  add column if not exists niche_confidence numeric,      -- similarité avec la niche retenue (0 à 1)
  add column if not exists niche_margin numeric,          -- écart avec la 2e niche la plus proche
  add column if not exists niche_source text,             -- 'detected' | 'discovery' | 'manual'
  add column if not exists niche_checked_at timestamptz,
  add column if not exists decided_at timestamptz;

alter table public.topics
  add column if not exists validated_by text,             -- 'auto' | 'admin'
  add column if not exists validation_reason text,
  add column if not exists validated_at timestamptz;

create index if not exists idx_topics_status_created on public.topics(status, created_at);
