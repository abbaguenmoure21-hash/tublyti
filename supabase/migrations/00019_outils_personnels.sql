-- ============================================================
-- 00019 — Favoris, alertes et jetons d'accès propres à chaque compte
-- À exécuter APRÈS 00018. Aucune donnée n'est supprimée :
-- tout ce qui existe déjà est attribué au compte administrateur.
-- ============================================================

-- 1. Colonnes propriétaire
alter table public.collections  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.alert_rules  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.alert_events add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.api_tokens   add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- 2. Attribution de l'existant au premier administrateur
do $$
declare
  admin_id uuid;
begin
  select user_id into admin_id from public.profiles where role = 'admin' order by created_at limit 1;
  if admin_id is null then
    raise notice 'Aucun administrateur dans profiles : exécute d''abord 00018.';
    return;
  end if;
  update public.collections  set user_id = admin_id where user_id is null;
  update public.alert_rules  set user_id = admin_id where user_id is null;
  update public.api_tokens   set user_id = admin_id where user_id is null;
  update public.alert_events e set user_id = r.user_id
    from public.alert_rules r where e.rule_id = r.id and e.user_id is null;
end $$;

-- 3. Une seule collection « Favoris » par compte
drop index if exists collections_one_default_per_user;
create unique index collections_one_default_per_user on public.collections (user_id) where is_default;
create index if not exists collections_user_idx  on public.collections (user_id);
create index if not exists alert_rules_user_idx  on public.alert_rules (user_id, enabled);
create index if not exists alert_events_user_idx on public.alert_events (user_id, read);
create index if not exists api_tokens_user_idx   on public.api_tokens (user_id);

-- 4. Règles d'accès : chacun ne voit que ses lignes.
-- Les anciennes règles « workspace » laissaient passer tout le monde (condition toujours vraie).
drop policy if exists "workspace_isolation" on public.collections;
drop policy if exists "workspace_isolation" on public.collection_items;
drop policy if exists "workspace_isolation" on public.api_tokens;
drop policy if exists "workspace_alert_rules" on public.alert_rules;
drop policy if exists "workspace_alert_events" on public.alert_events;
drop policy if exists "workspace_title_patterns" on public.title_patterns;

drop policy if exists "favoris personnels" on public.collections;
create policy "favoris personnels" on public.collections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "éléments de favoris personnels" on public.collection_items;
create policy "éléments de favoris personnels" on public.collection_items
  for all using (exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid()));

drop policy if exists "alertes personnelles" on public.alert_rules;
create policy "alertes personnelles" on public.alert_rules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "événements personnels" on public.alert_events;
create policy "événements personnels" on public.alert_events
  for select using (user_id = auth.uid());

drop policy if exists "jetons personnels" on public.api_tokens;
create policy "jetons personnels" on public.api_tokens
  for select using (user_id = auth.uid());
