-- ============================================================
-- 00030 — Historique des miniatures
-- YouTube garde la même adresse d'image quand une chaîne change sa miniature :
-- on compare donc l'empreinte de l'image chaque nuit, et on archive chaque version
-- (petite image 320×180) pour pouvoir montrer « avant / après ».
-- Non destructive : deux colonnes et un espace de stockage public en lecture.
-- ============================================================

alter table public.videos add column if not exists thumb_hash text;
alter table public.videos add column if not exists thumb_checked_at timestamptz;

insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;
