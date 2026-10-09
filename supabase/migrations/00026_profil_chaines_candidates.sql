-- ============================================================
-- 00026 — Profil complet des chaînes candidates pour mieux les classer
-- Description, mots-clés, catégories YouTube (topicDetails), tags et descriptions de vidéos,
-- et avis de l'IA (niche existante ou nouvelle niche proposée).
-- Non destructive : ajouts de colonnes uniquement.
-- ============================================================

alter table public.candidate_channels
  add column if not exists description text,
  add column if not exists keywords text,
  add column if not exists topic_categories text[],
  add column if not exists profile_text text,          -- texte complet utilisé pour classer la chaîne
  add column if not exists ai_niche text,              -- niche choisie ou proposée par l'IA
  add column if not exists ai_category text,
  add column if not exists ai_rpm_low numeric,
  add column if not exists ai_rpm_high numeric,
  add column if not exists ai_confidence numeric,
  add column if not exists ai_reason text;
