-- Liste d'attente de la landing page publique.
-- Aucune policy RLS : seule la clé service (server action) peut lire et écrire.
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_email_lower_idx on public.waitlist (lower(email));

alter table public.waitlist enable row level security;
