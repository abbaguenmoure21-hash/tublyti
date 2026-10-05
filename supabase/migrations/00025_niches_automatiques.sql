-- ============================================================
-- 00025 — Niches créées automatiquement
-- Quand plusieurs chaînes candidates semblables ne ressemblent à aucune niche suivie,
-- la collecte de nuit crée la niche et y ajoute ces chaînes.
-- Non destructive : ajouts de colonnes uniquement.
-- ============================================================

alter table public.niches
  add column if not exists auto_created boolean not null default false,
  add column if not exists created_from text,          -- 'candidates' | null (créée à la main)
  add column if not exists auto_reason text;           -- comment elle a été créée (chaînes d'origine, nommage)

-- Statut supplémentaire des chaînes candidates : 'unmatched' = hors des niches suivies,
-- en attente d'autres chaînes semblables (colonne texte, aucune contrainte à modifier).
create index if not exists idx_candidate_channels_unmatched on public.candidate_channels(status) where status = 'unmatched';
