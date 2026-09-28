# PLAN.md — TubLyTI

Chaque phase se termine par une porte de validation. On ne passe pas à la suivante tant qu'elle n'est pas franchie sur des données réelles. Les prompts référencés sont dans `PROMPTS.md`.

## Phase 0 — Préparation (semaine 0, sans code, ~3 h)

- Comptes : Google Cloud (projet `tublyti-dev`, YouTube Data API v3 activée, clé API restreinte à cette API), Supabase, Vercel, Anthropic, SerpApi (gratuit), Resend, GitHub.
- Copier les cinq fichiers de pilotage à la racine du dépôt vide.
- Préparer `seed/niches.csv` (3 niches, catégorie, coefficient RPM depuis YouTube Studio), `seed/channels.csv` (60-100 chaînes par niche, via vidIQ « similar channels »), `seed/queries.csv` (20 requêtes par niche).
- Porte : un appel `channels.list` réussi en ligne de commande ; `.env.local` rempli.

## Phase 1 — Fondations et collecte YouTube (semaines 1-2) — P1, P2

- Init Next.js 15 + TypeScript strict + Tailwind + shadcn ; Supabase ; migrations des 13 tables avec RLS ; auth mono-utilisateur.
- `YouTubeClient` avec comptage de quota ; cron `collect` : import des seeds, résolution des `uploads_playlist_id`, découverte des nouvelles vidéos, snapshots quotidiens.
- Pages Chaînes et Vidéos, page Admin/Jobs.
- Porte : 300 chaînes suivies, 3 nuits de snapshots, quota < 2 000/nuit, zéro job en erreur.

## Phase 2 — Commentaires et classification (semaines 3-4) — P3, P4

- Ingestion `commentThreads` (200-500 par vidéo de moins de 60 jours, tri pertinence).
- `LLMClassifier` Haiku Batch, prompt versionné, 5 labels + angle demandé + confiance.
- Page Frustrations par vidéo et par niche, tri par likes.
- Porte : 10 000 commentaires classés ; 100 relus à la main → ≥ 80 % justes ; coût < 3 $.

## Phase 3 — Signaux externes et sujets (semaines 5-6) — P5, P6

- `TrendProvider` (SerpApi, 1 requête/sujet/semaine), `SocialProvider` (HN Algolia + Stack Exchange, 1 comptage/sujet/jour ; Reddit exclu), table `trend_points`.
- `EmbeddingProvider`, embeddings des titres et des angles demandés, clustering en sujets (cosinus ≥ 0,85), page Sujets à valider.
- Répartition des 100 recherches YouTube quotidiennes sur les requêtes des sujets prioritaires.
- Porte : chaque niche a ≥ 20 sujets actifs avec au moins deux séries sur 30 jours.

## Phase 4 — Scoring et matrice (semaine 7) — P7, P8, P9

- `lib/scoring/mgi.ts` + `phase.ts` testés ; cron `score` ; `settings.mgi_weights`.
- Matrice d'opportunités (nuage demande × offre, filtre océan bleu), fiche sujet complète, bouton « en production ».
- Alertes Resend : burn-down, cron en échec, silence 36 h.
- Porte : top 10 d'une niche lisible en 10 secondes ; alerte test reçue.

## Phase 5 — Angles et MCP (semaine 8) — P10, P11

- `AngleGenerator` (Sonnet) : 5 angles nourris par les frustrations réelles et les titres concurrents ; export brief Markdown.
- Serveur MCP HTTP : `list_opportunities`, `get_topic`, `mark_in_production`.
- Porte : depuis Claude Cowork, obtenir le top 5 de Wealth Decoded et un angle en une question.

## Phase 6 — Sécurité et déploiement (semaine 9) — P12, P13

- Audit sécurité complet, tests des cinq parcours, deuxième projet Google Cloud `tublyti-prod`, variables Vercel, `vercel.json` crons, domaine.
- Demande d'extension de quota YouTube (formulaire Google) avec captures d'écran.
- Porte : 7 nuits de crons en production sans intervention ; RLS vérifiée avec un second compte.

## Phase 7 — Calibration (semaines 10-13)

- Une vidéo par chaîne produite à partir d'un sujet TubLyTI ; `angles.video_id` renseigné.
- À J+30 : comparer les vues à la médiane de la chaîne ; ajuster `mgi_weights` ; relire 100 nouveaux commentaires.
- Porte SaaS : 2 vidéos sur 3 au-dessus de la médiane, 30 nuits sans intervention → ouvrir la phase multi-tenant (voir doc « Passage en SaaS »).
