-- ============================================================
-- 00022 — Chaque vidéo de « Mes vidéos » appartient à une chaîne du client
-- (pour filtrer Mes vidéos et Résultats sur la chaîne choisie dans « Afficher »).
-- À exécuter après 00021. Aucune donnée supprimée.
-- ============================================================
alter table public.angles
  add column if not exists user_channel_id uuid references public.user_channels(id) on delete set null;
create index if not exists angles_user_channel_idx on public.angles (user_channel_id);

-- Vidéos existantes : rattachées à la chaîne du client sur la même thématique quand il n'y en a qu'une.
update public.angles a
set user_channel_id = uc.id
from public.topics t, public.user_channels uc
where a.user_channel_id is null
  and a.user_id is not null
  and t.id = a.topic_id
  and uc.user_id = a.user_id
  and uc.niche_id = t.niche_id
  and (select count(*) from public.user_channels u2 where u2.user_id = a.user_id and u2.niche_id = t.niche_id) = 1;
