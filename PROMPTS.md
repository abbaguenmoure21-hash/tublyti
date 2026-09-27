# PROMPTS.md — Bibliothèque de prompts TubLyTI

À coller dans Claude Code, dans l'ordre. Un prompt = une session. Entre deux prompts : tester sur des données réelles, signaler les bugs avec la structure « ce que j'ai fait / ce que j'attendais / ce qui s'est passé / message d'erreur complet ».

---

## P1 — Démarrage du projet

Tu es le CTO et Lead Developer de TubLyTI. À la racine du projet se trouvent cinq fichiers à lire intégralement avant toute action : CLAUDE.md, PRD.md, ARCHITECTURE.md, AI_RULES.md et PLAN.md.

Ta première mission, Phase 1 du PLAN.md :
1. Initialiser le projet Next.js 15 (App Router) avec TypeScript strict, Tailwind CSS, shadcn/ui, pnpm, ESLint, Prettier et Vitest.
2. Configurer Supabase (client serveur et client navigateur) et écrire la migration initiale avec les 13 tables d'ARCHITECTURE.md, l'extension pgvector, les index, et Row Level Security activée sur chaque table avec une politique par workspace_id.
3. Mettre en place l'authentification Supabase (email + mot de passe, un seul utilisateur, inscription fermée par variable d'environnement).
4. Créer la structure de dossiers d'ARCHITECTURE.md avec des interfaces vides pour YouTubeClient, TrendProvider, SocialProvider, EmbeddingProvider, LLMClassifier, chacune avec une implémentation Fake.
5. Créer `.env.example` sans valeurs et `vercel.json` avec les trois crons.

Avant de coder, présente-moi ton plan en 10 lignes maximum et attends ma validation. Ensuite avance et montre-moi ce qui est fait à la fin. Les clés seront saisies par moi dans .env.local, ne me les demande jamais dans la conversation.

---

## P2 — Collecte YouTube et journal des jobs

Implémente le cron `collect` (Phase 1, suite).

Comportement attendu :
- Une route `app/api/cron/collect/route.ts` protégée par `CRON_SECRET`, qui ouvre une ligne `jobs`, pose un verrou, et traite par lots avec une limite de 4 minutes d'exécution.
- `YouTubeClient` (lib/youtube/client.ts) : toutes les méthodes comptent le quota consommé (channels.list = 1, playlistItems.list = 1, videos.list = 1, commentThreads.list = 1) et lèvent `QuotaSoftLimitReached` quand `jobs.quota_used` du jour atteint `YT_QUOTA_SOFT_LIMIT`. Aucune méthode `search` dans ce fichier.
- Import des seeds : une commande `pnpm seed` qui lit seed/niches.csv, seed/channels.csv, seed/queries.csv (identifiants ou URLs de chaînes acceptés, résolution en channel id par lots de 50).
- Pour chaque chaîne, par ordre de `last_checked_at` croissant : mettre à jour `subscriber_count` et `uploads_playlist_id`, lire la première page de la playlist uploads, insérer les vidéos inconnues (upsert), calculer `is_qualified`.
- Snapshot quotidien (`videos.list` par lots de 50) pour toutes les vidéos de moins de 90 jours ; hebdomadaire pour les autres.
- Page /channels (liste, dernière vérification, ajout par URL, suppression avec confirmation) et page /admin/jobs (20 derniers runs, quota, erreurs, bouton relancer).

Écris des tests Vitest pour le comptage de quota et l'arrêt propre. Montre-moi le résultat d'une exécution locale sur les seeds avant de conclure.

---

## P3 — Ingestion des commentaires

Ajoute à `collect` l'ingestion des commentaires (Phase 2).

- Pour chaque vidéo de moins de 60 jours dont on n'a pas encore les commentaires (ou dont le dernier import date de plus de 7 jours) : `commentThreads.list`, tri par pertinence, jusqu'à 5 pages de 100, en respectant le quota.
- Stocker dans `comments` (upsert par id), en ignorant les commentaires de moins de 15 caractères et les réponses.
- Priorité aux vidéos des sujets en phase 0, 1 ou 2, puis aux vidéos les plus vues.
- Purge automatique des commentaires de plus de 90 jours dont le label est déjà enregistré.

Montre-moi le volume importé et le quota consommé sur une nuit simulée.

---

## P4 — Classification NLP des frustrations

Implémente `LLMClassifier` avec Claude Haiku 4.5 via la Batch API et le cron `classify` (Phase 2).

Prompt à placer dans lib/nlp/prompts/classify_v1.md :

« Tu analyses des commentaires YouTube pour détecter une demande de contenu non satisfaite. Pour chaque commentaire, réponds en JSON strict avec : label parmi no_one_explains (personne ne traite ce sujet), wish_video_on (souhait explicite d'une vidéo sur un point précis), stopped_too_early (la vidéo s'arrête là où ça devenait utile), searched_long (la personne a cherché longtemps sans trouver), none ; requested_angle : en une phrase courte en anglais, ce que la personne voudrait voir traité, ou null ; confidence : nombre entre 0 et 1. Ignore les compliments, les insultes et les commentaires hors sujet (label none). Ne déduis rien qui ne soit pas écrit. »

- Envoyer par lots de 500 commentaires, un commentaire par requête de batch, en enregistrant `PROMPT_VERSION` dans `comment_labels.model`.
- Estimer le coût avant envoi et refuser au-delà de `AI_BUDGET_USD` mensuel.
- Récupérer les résultats du batch à l'exécution suivante si non prêts (état persistant dans `settings.pending_batches`).
- Page /frustrations : par niche puis par vidéo, les commentaires avec label ≠ none, triés par likes, avec l'angle demandé et une action « corriger le label » (la correction est stockée avec model = 'human').

Montre-moi 20 exemples classés avec leur label pour que je vérifie la qualité.

---

## P5 — Signaux externes (Trends, Reddit, Hacker News)

Implémente `TrendProvider` et `SocialProvider` et leur intégration dans `collect` (Phase 3).

- `TrendProvider` : implémentation SerpApi (moteur google_trends, `interest_over_time`, 90 jours, région US) ; une requête par sujet actif par semaine ; stockage des points dans `trend_points` (source `trends`). Prévoir une seconde implémentation SearchApi vide mais câblée, sélection par `TREND_PROVIDER`.
- `SocialProvider` : Reddit (OAuth script, `search` sur les subreddits configurés par niche, comptage des posts des 30 derniers jours par sujet, respect de 100 requêtes/minute) et Hacker News (API Algolia, `search_by_date`, comptage 30 jours). Un comptage par sujet par jour, source `reddit` et `hn`.
- Source `yt_views` : somme quotidienne des vues des vidéos du sujet, divisée par le nombre de vidéos, calculée depuis `video_snapshots`.
- Sur la fiche sujet, afficher les quatre séries sur 90 jours.

Toutes les requêtes externes ont un timeout de 10 secondes et une gestion d'erreur qui n'interrompt pas le job.

---

## P6 — Sujets, embeddings et clustering

Implémente `EmbeddingProvider` (Voyage AI `voyage-4-lite`, 1024 dimensions, `input_type` = "document" pour le stockage et "query" pour la recherche, lots de 128 textes max, retry exponentiel sur 429 car le compte peut être en palier gratuit à faible débit) et le regroupement en sujets (Phase 3, suite).

- Embedding des titres de vidéos (`videos.title_embedding`) et des `requested_angle` des commentaires classés, par lots, avec cache (jamais deux fois le même texte).
- Rattachement d'une vidéo à un sujet existant si la similarité cosinus avec `topics.embedding` ≥ 0,85 ; sinon création d'un sujet `proposed` à partir d'un cluster d'au moins 3 titres ou angles proches.
- `topics.embedding` = moyenne des embeddings de ses membres, recalculée à chaque ajout.
- Page /topics/review : sujets proposés, membres, actions accepter / fusionner avec / rejeter.
- Répartition des 100 recherches YouTube quotidiennes (lib/youtube/search.ts, seul fichier autorisé à appeler search.list) sur les `topic_queries` des sujets actifs, priorité aux phases 0-2, `order=date`, `publishedAfter` 30 jours, pour découvrir les vidéos hors des chaînes suivies.

---

## P7 — Scoring MGI et phases

Implémente `lib/scoring/mgi.ts`, `lib/scoring/phase.ts` et le cron `score` (Phase 4).

Formule : MGI = D × (1 + F) / (1 + O_q) × P, avec les définitions exactes d'ARCHITECTURE.md (section Règles de calcul). Les poids et seuils sont lus dans `settings.mgi_weights` et `settings.thresholds`, avec des valeurs par défaut créées à la première exécution.

- Fonctions pures, sans accès base, testées avec Vitest : signal manquant (redistribution des poids), sujet sans commentaire (F = 0), sujet sans vidéo qualifiée (O_q = 0), percentile sur un seul sujet.
- Le cron écrit une ligne `topic_scores` par sujet actif et par jour, et met à jour `topics.phase`.
- Détection burn-down : compte des vidéos qualifiées publiées dans les 72 dernières heures par sujet ; si ≥ 5 et statut `in_production`, déclencher l'alerte (P9).

Montre-moi le top 10 par MGI de chaque niche après une exécution.

---

## P8 — Opportunity Matrix et fiche sujet

Construis l'interface principale (Phase 4, suite).

- /dashboard : sélecteur de niche ; nuage de points (Recharts) avec offre qualifiée en X, demande en Y, taille du point = frustration, couleur = phase ; filtre « océan bleu » (demande ≥ 60, offre ≤ 3) ; sous le graphique, tableau trié par MGI (sujet, MGI, phase, frustration, vidéos qualifiées, tendance 30 j en mini-courbe).
- /topics/[id] : titre, MGI et ses quatre composantes, phase avec explication en une phrase, quatre courbes de signaux sur 90 jours, vidéos qualifiées concurrentes (titre, chaîne, vues, date), les 20 commentaires frustrés les plus likés avec leur angle demandé, bloc Angles (P10), boutons « Marquer en production » et « Marquer publiée » (avec saisie de l'id de la vidéo publiée).
- Trois états gérés partout ; mobile lisible ; textes en français.

---

## P9 — Alertes email

Configure Resend et trois alertes (Phase 4, fin).

1. Burn-down : « Sujet {label} : {n} chaînes ont publié en 72 h. Fenêtre en train de se fermer. » avec lien vers la fiche.
2. Cron en échec : envoyée depuis `runner.ts` quand `jobs.error` est renseigné.
3. Collecte silencieuse : vérification dans `score` qu'un snapshot a été écrit dans les 36 dernières heures ; sinon alerte.

Un seul bouton par email, objet court, expéditeur configuré via `ALERT_EMAIL`. Ajoute un bouton « Envoyer une alerte test » dans /admin/jobs.

---

## P10 — Générateur d'angles

Implémente `AngleGenerator` (Claude Sonnet) et la route POST /api/topics/[id]/angles (Phase 5).

Contexte fourni au modèle : label du sujet, niche et coefficient RPM, les 20 frustrations les plus likées avec leur angle demandé, les titres des 10 vidéos qualifiées concurrentes, la phase.

Prompt à placer dans lib/nlp/prompts/angles_v1.md :

« Tu es stratège éditorial pour des chaînes YouTube. À partir des frustrations réelles des spectateurs et des vidéos concurrentes ci-dessous, propose exactement 5 angles de vidéo originaux (8 à 20 minutes) qui répondent à une frustration précise sans reprendre un angle concurrent. Chaque angle : title (≤ 60 caractères, en anglais), hook (2 phrases), rationale (quelle frustration il résout, quel angle concurrent il évite, en français). Réponds en JSON strict. Pas de clickbait mensonger, pas de promesse de gain chiffrée. »

- Stocker dans `angles`, afficher sur la fiche sujet, permettre de régénérer (coût affiché avant) et d'exporter un angle en brief Markdown (sujet, angle, 10 frustrations sources, concurrents) via un bouton « Copier le brief ».

---

## P11 — Serveur MCP

Expose TubLyTI via un serveur MCP sur la route /api/mcp (transport HTTP streamable, authentification par `MCP_TOKEN`) avec trois outils (Phase 5, suite) :

- `list_opportunities({ niche: string, limit?: number, phase?: number })` → sujets triés par MGI avec leurs composantes et la phase.
- `get_topic({ topic_id })` → fiche complète (scores, 20 frustrations, concurrents, angles).
- `mark_in_production({ topic_id, angle_id? })` → change le statut et renvoie une confirmation.

Fournis la configuration à coller dans Claude Desktop / Claude Cowork, et teste les trois outils avec l'inspecteur MCP.

---

## P12 — Audit de sécurité avant déploiement

Avant que je déploie cette version, fais un audit de sécurité complet en jouant le rôle d'une personne malveillante. Vérifie et liste tout, même mineur :

- RLS active sur les 13 tables, politiques testées avec un second utilisateur qui ne doit rien voir.
- Aucune clé (YouTube, Anthropic, service role, SerpApi, Reddit) accessible côté client ou dans le bundle.
- Routes cron et MCP inaccessibles sans jeton ; jetons comparés en temps constant.
- Validation Zod sur toutes les entrées ; aucune injection possible via les URLs de chaînes ou les requêtes de sujets.
- Aucun secret ni fichier .env dans l'historique git.
- Les jobs ne peuvent pas être déclenchés en boucle par un tiers (verrou + jeton).
- Les erreurs affichées ne révèlent ni stack trace ni structure de base.

Propose les correctifs et applique-les après ma validation.

---

## P13 — Déploiement en production

Prépare le déploiement (Phase 6).

1. Liste toutes les variables d'environnement à créer sur Vercel, avec pour chacune : dev ou prod, où l'obtenir. Le projet Google Cloud de production est distinct de celui de dev.
2. Vérifie `vercel.json` : trois crons (collect 02:00, classify 03:00, score 05:00 UTC), timeouts adaptés.
3. Écris une checklist post-déploiement : URL autorisées dans Supabase Auth, test de chaque cron via appel manuel avec le jeton, alerte test reçue, première nuit surveillée.
4. Rédige le texte de la demande d'extension de quota YouTube (formulaire Google) décrivant l'usage réel, les volumes et la conformité aux conditions de l'API.

Ne déploie rien toi-même : donne-moi les étapes, je clique.

---

## P14 — Calibration (à lancer au mois 3)

Lis `angles` où `status = published` et `video_id` est renseigné. Pour chaque vidéo : vues à J+30 (depuis `video_snapshots`), médiane des vues à J+30 des 20 dernières vidéos de la même chaîne, MGI du sujet le jour du marquage « en production ». Produis un tableau et une proposition de nouveaux poids `mgi_weights` qui auraient mieux classé les sujets gagnants, avec ton raisonnement. N'applique rien sans ma validation.
