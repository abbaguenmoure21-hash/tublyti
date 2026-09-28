# PRD.md — TubLyTI (version 1, outil interne)

## Vision

Donner à un créateur faceless, chaque semaine et en 10 minutes, les cinq sujets de sa niche où la demande dépasse l'offre, avec la preuve (signaux chiffrés, commentaires frustrés en clair) et cinq angles prêts à briefer une production vidéo.

## Utilisateur

Un seul en version 1 : ABBA, opérateur de trois chaînes YouTube faceless anglophones (finance, psychologie, outils IA), travaillant en français, 8 à 12 heures par semaine, qui produit déjà ses vidéos avec un pipeline d'agents Claude. Il utilise TubLyTI le dimanche depuis un ordinateur, et en semaine depuis Claude Cowork via MCP.

## Objets métier

- **Niche** : un territoire éditorial suivi (ex. « dividend investing »), rattaché à une chaîne, avec un coefficient de monétisation.
- **Sujet** : une idée de vidéo au niveau « requête », regroupant plusieurs formulations (ex. « dividend snowball », « how to live off dividends »). Un sujet a un MGI, une phase, des frustrations, des angles.
- **Chaîne surveillée** : une chaîne YouTube dont on suit les uploads et les métriques.
- **Vidéo** : une vidéo découverte, rattachée à une chaîne et (si possible) à un sujet, avec des snapshots de métriques datés.
- **Commentaire classé** : un commentaire avec un label de frustration et l'angle demandé extrait.
- **Signal externe** : un point daté (Trends, HN, Stack Exchange) pour un sujet.
- **Angle** : une proposition de vidéo (titre, hook, justification) générée pour un sujet, avec un statut (idée, en production, publiée).

## Fonctionnalités de la version 1

### Collecte (automatique, nuit)

- Suivi de 300 à 500 chaînes réparties sur 3 à 5 niches.
- Découverte des nouvelles vidéos via la playlist uploads de chaque chaîne.
- Snapshot quotidien des vues, likes, commentaires de chaque vidéo de moins de 90 jours ; hebdomadaire au-delà.
- Ingestion des 200 à 500 commentaires les plus pertinents des vidéos de moins de 60 jours.
- Une requête Google Trends par sujet par semaine ; un comptage Hacker News + Stack Exchange par sujet par jour.
- 100 recherches YouTube par jour, réparties sur les requêtes des sujets, par ordre de priorité (sujets en phase 0-2 d'abord).

### Analyse (automatique, nuit)

- Classification de chaque commentaire en 5 labels : `no_one_explains`, `wish_video_on`, `stopped_too_early`, `searched_long`, `none`, avec `requested_angle` (texte libre court) et `confidence`.
- Regroupement des titres de vidéos et des angles demandés en sujets par similarité d'embedding (seuil cosinus 0,85), avec proposition de nouveaux sujets à valider.
- Calcul quotidien du MGI par sujet et de sa phase de propagation.
- Détection burn-down : plus de 5 vidéos qualifiées en 72 heures sur un sujet marqué « en production ».

### Interface

- **Matrice d'opportunités** par niche : nuage de points demande × offre qualifiée, taille = frustration, couleur = phase ; filtre « océan bleu » ; tri par MGI.
- **Fiche sujet** : les trois signaux en courbes sur 90 jours, les vidéos concurrentes qualifiées, les 20 commentaires frustrés les plus likés avec leur angle, les angles générés, le bouton « Marquer en production ».
- **Chaînes** : liste, dernière vérification, ajout/suppression, import CSV.
- **Sujets à valider** : nouveaux clusters proposés par l'analyse, à accepter, fusionner ou rejeter.
- **Admin / Jobs** : derniers runs, quota consommé, erreurs, bouton « relancer ».
- **Alertes email** : burn-down, cron en échec, collecte silencieuse depuis 36 h.

### Génération

- Cinq angles par sujet, générés à la demande par Claude Sonnet, nourris par : le label du sujet, les 20 frustrations les plus likées, les titres des 10 vidéos concurrentes, le RPM cible de la niche. Chaque angle = titre (≤ 60 caractères), hook (2 phrases), justification (quelle frustration il résout, quel angle concurrent il évite).
- Export d'un angle en brief Markdown compatible avec le skill de package vidéo existant.

### Accès programmatique

- Serveur MCP (transport HTTP, authentifié par jeton) avec trois outils : `list_opportunities(niche, limit)`, `get_topic(topic_id)`, `mark_in_production(topic_id)`.

## Hors périmètre de la version 1

Paiements, multi-comptes, landing page, TikTok, scraping headless, transcriptions, analyse de miniatures, application mobile, prédiction XGBoost.

## Critères de succès de la version 1

- 30 nuits de crons consécutives sans intervention manuelle.
- Quota YouTube quotidien moyen < 3 000 unités.
- Coût IA mensuel < 30 $.
- ≥ 80 % de précision sur 100 commentaires relus à la main.
- Au moins 2 vidéos sur 3 issues de TubLyTI au-dessus de la médiane de vues à J+30 de leur chaîne.

## Version 2

Voir `PLAN_V2.md` : fluidité, design system clair (`DESIGN.md`), page Aujourd'hui, palette ⌘K, pipeline, réglages, digest, MCP v2 et extension Chrome (panneau latéral + badge, sans lecture du HTML de YouTube).
