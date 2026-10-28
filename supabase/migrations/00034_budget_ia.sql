-- 00034 — Budget IA atomique (domaine backend-ai-scoring)
-- Non destructive, idempotente.
--
-- Avant : chaque service lisait settings.value (ai_spend_YYYY_MM) puis écrivait
-- value = lu + coût. Deux appels simultanés s'écrasaient (dépense perdue) et le
-- contrôle « reste-t-il du budget ? » pouvait être passé par N requêtes à la fois.
--
-- ai_budget_add(key, delta, limit) ajoute delta au compteur en une seule
-- instruction (verrou de ligne). Si limit est fourni et delta > 0, l'ajout est
-- refusé quand le total dépasserait limit : la fonction renvoie alors NULL et
-- le compteur ne bouge pas. Sinon elle renvoie le nouveau total.
-- Un delta négatif (remboursement d'une réservation) n'est jamais refusé et le
-- compteur ne descend pas sous 0.

create or replace function public.ai_budget_add(p_key text, p_delta numeric, p_limit numeric default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new numeric;
begin
  if p_key !~ '^ai_spend_[0-9]{4}_[0-9]{2}$' then
    raise exception 'ai_budget_add: clé invalide %', p_key;
  end if;

  insert into settings (key, value) values (p_key, to_jsonb(0::numeric))
  on conflict (key) do nothing;

  update settings
     set value = to_jsonb(greatest(0, coalesce(
           case when jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric end, 0) + p_delta))
   where key = p_key
     and (
       p_limit is null
       or p_delta <= 0
       or coalesce(case when jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric end, 0) + p_delta <= p_limit
     )
  returning (value #>> '{}')::numeric into v_new;

  return v_new; -- NULL = refusé (plafond)
end;
$$;

revoke all on function public.ai_budget_add(text, numeric, numeric) from public;
revoke all on function public.ai_budget_add(text, numeric, numeric) from anon, authenticated;
grant execute on function public.ai_budget_add(text, numeric, numeric) to service_role;

-- ── Commentaires à classer (anti-jointure côté base) ─────────────────
-- Avant : on lisait les N commentaires les plus likés puis on filtrait en JS,
-- ce qui se bloquait dès que les 1 000 premiers (plafond PostgREST) étaient tous
-- étiquetés. Ici la base renvoie directement les non-étiquetés.
create index if not exists idx_comments_like_count on comments (like_count desc);

create or replace function public.unlabeled_comments(p_limit integer default 500)
returns table (id text, text text)
language sql
stable
set search_path = public
as $$
  select c.id, c.text
    from comments c
    left join comment_labels cl on cl.comment_id = c.id
   where cl.comment_id is null
   order by c.like_count desc nulls last
   limit greatest(1, least(p_limit, 5000));
$$;

revoke all on function public.unlabeled_comments(integer) from public;
revoke all on function public.unlabeled_comments(integer) from anon, authenticated;
grant execute on function public.unlabeled_comments(integer) to service_role;
