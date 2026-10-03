-- 00020 — Faisabilité par client
-- 1. Stocker les abonnés des concurrents dans topic_scores (lecture seule par le client)
-- 2. Permettre de stocker les abonnés des chaînes clients (user_channels)

-- topic_scores : abonnés des chaînes concurrentes (triés, 200 max)
alter table topic_scores
  add column if not exists competitor_subs int[];

-- user_channels : abonnés de la chaîne YouTube du client
alter table user_channels
  add column if not exists subscriber_count int,
  add column if not exists subscribers_checked_at timestamptz;
