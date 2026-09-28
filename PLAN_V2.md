# PLAN_V2.md — TubLyTI V2 : fluidité, design, fonctionnalités, MCP, extension Chrome

> Mis à jour le 28 sept. 2026 après l'étude concurrentielle (`design/Fonctionnalités concurrents pour TubLyTI.md`) : ajout de la phase 10 bis, MCP orienté synthèse, extension enrichie, liste « hors périmètre ».

Ordre décidé : **corrections + fluidité → design system → fonctionnalités → MCP v2 → extension Chrome → mise en production**. Chaque phase a une porte de validation ; on ne passe pas à la suivante sans l'avoir franchie. Prompts correspondants dans `PROMPTS_V2.md`.

## Audit de départ (code au 27 sept. 2026, commit 4a9cae4)

Problèmes constatés dans le code, à corriger en phase 8 :

| # | Problème | Fichier | Effet |
| --- | --- | --- | --- |
| A1 | `list_opportunities` cherche la niche par `name ILIKE '%finance%'` alors que les noms sont « Dividend & passive income investing » ; la catégorie `finance` n'est pas consultée | `lib/mcp/server.ts` | Claude Cowork répond « Niche introuvable » |
| A2 | Les scores sont filtrés sur `scored_at = aujourd'hui` ; avant le cron de 05:00 UTC il n'y a rien | `lib/mcp/server.ts`, API dashboard | Écran/réponse vide chaque matin |
| A3 | Le jeton MCP est accepté dans l'URL (`?token=`) et comparé avec `===` | `app/api/mcp/route.ts` | Fuite possible dans les logs, comparaison non constante |
| A4 | `--font-sans: var(--font-sans)` est circulaire | `app/globals.css` | Geist ne s'applique pas, police système à la place |
| A5 | `<title>Create Next App</title>`, `lang="en"`, favicon Next par défaut | `app/layout.tsx`, `public/` | Onglet anonyme, lecteurs d'écran en anglais |
| A6 | 8 pages en `'use client'` qui chargent tout via `fetch` dans `useEffect` (16 appels) | `app/(app)/**` | Écran squelette à chaque navigation, pas de cache, retour arrière qui recharge |
| A7 | Filtres (niche, océan bleu) en état local, pas dans l'URL | `dashboard/page.tsx` | Filtres perdus au retour, liens non partageables |
| A8 | Couleurs de phase codées en dur (12 hex, 3 oklch dans les composants) | dashboard, topic | Incohérences, impossible de changer la palette |
| A9 | Libellés sans accents (« Chaines », « Generer ») | pages, sidebar | Finition amateur |
| A10 | Barre latérale toujours affichée, pas de version mobile ; état replié non mémorisé | `components/app-sidebar.tsx` | Inutilisable sur téléphone |

## Phase 8 — Corrections et fluidité (2 sessions)

- Corriger A1 à A10.
- Passer les pages en **Server Components** qui lisent Supabase côté serveur, avec `loading.tsx` par route (squelettes) et `<Suspense>` par bloc ; ne garder en client que les îlots interactifs (graphique, filtres, boutons).
- Mutations en **Server Actions** + `useOptimistic` + `revalidatePath` ; toasts `sonner`.
- Filtres dans l'URL (`?niche=…&ocean=1`) via `nuqs` ou `useSearchParams`.
- Préchargement : liens `next/link` (préchargement par défaut), `prefetch` au survol des lignes de tableau.
- **Porte** : navigation Matrice → Sujet → retour en < 300 ms perçus (pas d'écran blanc) ; Lighthouse Performance ≥ 90 et Accessibilité ≥ 95 sur `/dashboard` ; 0 `useEffect(fetch)` restant dans `app/(app)`.

## Phase 9 — Design system clair (2 sessions)

- Appliquer `DESIGN.md` : tokens dans `globals.css`, barre latérale claire, composants `PhaseBadge`, `MgiScore`, `KpiCard`, `EmptyState`, `ErrorState`, `DataTable` (tri, `j`/`k`), `PageHeader`.
- Thème clair par défaut, bouton clair/sombre/système (`next-themes`), mémorisé.
- Barre latérale : 240 px, repliable (mémorisé), devient un `Sheet` sous 768 px ; barre supérieure mobile avec menu.
- Logo et favicon TubLyTI (SVG simple : pastille violette + « T »), titre d'onglet dynamique (« Matrice · TubLyTI »).
- **Porte** : `grep` ne trouve plus aucun hex/oklch dans `app/` et `components/` hors `globals.css` ; contraste AA vérifié (axe DevTools : 0 erreur sérieuse) ; utilisable à 375 px de large.

## Phase 10 — Fonctionnalités qui rendent l'usage fluide (3 sessions)

Par ordre de valeur :

1. **Aujourd'hui** (nouvelle page d'accueil `/today`) : un flux quotidien court et argumenté (pas 50 idées génériques comme vidIQ) avec 1 à 3 « meilleures actions du jour » ; par chaîne, les 3 meilleures opportunités (phase 2 d'abord, puis MGI × faisabilité), les alertes burn-down, ce qui a changé depuis ta dernière visite (nouveaux sujets, changements de phase), l'état des crons en une ligne.
2. **Palette de commandes ⌘K** (`cmdk`) : aller à un sujet, une niche, une page ; actions (« Générer des angles pour… », « Ajouter une chaîne »). Raccourcis : `g t` Aujourd'hui, `g m` Matrice, `g p` Pipeline, `/` recherche, `?` aide des raccourcis.
3. **Pipeline de production** (`/pipeline`, kanban) : Idée → En production → Publiée → Mesurée (J+30), glisser-déposer, carte = sujet + angle choisi + chaîne ; à « Publiée », saisie de l'URL YouTube ; à J+30, vues comparées à la médiane de la chaîne. **Boucle de calibration visible** : taux de réussite du MGI par tranche de score, ajustement des poids proposé (aucun concurrent n'audite ses prédictions). Le pipeline s'arrête au brief : la production passe à Vrily.
4. **Collections (swipe file)** : sauvegarde en un clic de sujets, vidéos, chaînes, frustrations et angles, avec notes (standard chez NexLev, 1of10, Viewstats).
5. **Réglages** (`/settings`) : curseurs des poids du MGI avec aperçu du nouveau classement avant d'enregistrer ; gestion des niches (nom, catégorie, coefficient RPM, chaîne liée, sites Stack Exchange) ; jetons API (MCP, extension) ; thème.
6. **Brief exportable** : bouton « Copier le brief » amélioré (Markdown complet : sujet, angle, 10 frustrations sources avec liens, 5 concurrents, phase, MGI) + « Télécharger .md ».
7. **Digest du dimanche** par email (Resend) : top 5 par chaîne + sujets passés en phase 2 dans la semaine.
- **Porte** : un dimanche réel, tu fais ta routine hebdomadaire (choisir 3 sujets, générer les angles, les passer en production) en moins de 10 minutes, presque entièrement au clavier.

## Phase 10 bis — Fonctions inspirées des concurrents (4 sessions)

Issues de l'étude concurrentielle, classées par valeur/effort. Prompts P29 à P35.

| Fonction | Effort | Inspiré de | Prompt |
| --- | --- | --- | --- |
| Bandes du MGI, confiance, fraîcheur des données, RPM en fourchette | S | vidIQ (bandes), contre-exemples NexLev/Viewstats (données fausses) | P29 |
| Coût IA annoncé et confirmé avant chaque génération, journal des dépenses | S | contre-exemple vidIQ (crédits brûlés) | P29 |
| Score d'outlier daté (même âge, médiane des 10 vidéos précédentes) + infobulle | S | Viewstats, OutlierKit | P30 |
| Filtre taille de chaîne, vue « outliers de petites chaînes » | S | Viewstats, vidIQ | P30 |
| Flux d'activité : uploads, changements de titre/miniature, pics | M | Viewstats, 1of10 | P31 |
| Chaînes candidates (découverte) + chaînes similaires | M | NexLev Niche Finder, OutlierKit | P32 |
| Note de faisabilité A–F pour tes propres chaînes | M | Morningfame | P33 |
| Alertes personnalisées déclenchées par les changements de phase | M | vidIQ Trend Alerts, Viewstats | P34 |
| Formules de titres des outliers injectées dans les angles | S–M | TubeLab, 1of10 | P35 |
| Dossier de niche/sujet exportable (Markdown + PDF) | M | Faceless Niches, NexLev Niche Overview | P35 |

- **Porte** : sur une niche, tu peux répondre en moins de 2 minutes à « ce sujet est-il fiable, puis-je y entrer avec ma chaîne, et que réclament les spectateurs ? », et exporter le dossier.

## Phase 11 — MCP v2 (1 session)

- Corriger A1, A2, A3 (déjà faits en phase 8, vérifier).
- Migrer vers `registerTool` avec `title`, annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) et sortie structurée (`outputSchema` + texte lisible).
- Positionnement : la **synthèse** (écart, phase, frustrations, faisabilité), pas le volume d'outils bruts (NexLev 60+, vidIQ ~76).
- Lecture : `list_niches`, `list_today`, `list_opportunities`, `search_topics`, `get_topic_gap`, `get_topic_phase`, `list_frustrations`, `get_niche_dossier`, `channel_outliers`, `similar_channels`.
- Écriture : `generate_angles` (coût annoncé, refus au-delà du budget), `save_to_collection`, `create_pipeline_card`, `mark_published`, `add_candidate_channel`.
- Plafonds quotidiens par outil et par jeton (comme NexLev), message clair quand un plafond est atteint.
- Ressource `tublyti://brief/today` et prompt MCP `plan_my_week` (propose 3 sujets par chaîne avec justification).
- Jetons : un jeton lecture seule et un jeton lecture/écriture (table `api_tokens`, stockés hachés, révocables depuis Réglages).
- **Porte** : depuis Claude Cowork, « Qu'est-ce que je tourne cette semaine sur Mind Unlocked ? » renvoie 3 sujets réels ; « passe le 2e en production » fonctionne ; l'inspecteur MCP liste les 15 outils sans erreur.

## Phase 12 — Extension Chrome « panneau latéral + badge » (2-3 sessions)

Principe anti-fragilité : l'extension **ne lit jamais le HTML de YouTube**. Elle lit uniquement l'URL de l'onglet (`/watch?v=ID`, `/@handle`, `/channel/ID`, `/results?search_query=…`) et interroge l'API TubLyTI, qui interroge l'API officielle YouTube. Un changement de design de YouTube ne peut donc pas la casser.

- **Stack** : dossier `extension/` dans le dépôt (workspace pnpm), framework **WXT** (Manifest V3, React, Tailwind, rechargement à chaud), tokens de `DESIGN.md` partagés.
- **Permissions minimales** : `sidePanel`, `storage`, `tabs` ; `host_permissions` : `https://www.youtube.com/*` (lire l'URL de l'onglet) et le domaine de TubLyTI. Aucun script de contenu.
- **Badge** sur l'icône : sur une vidéo ou une chaîne connue, pastille couleur de phase + texte (`P2`, `P3`) ; gris « + » si inconnue.
- **Panneau latéral** selon la page :
  - Vidéo : score d'outlier daté et son explication, sujet(s) rattaché(s) ou sujet le plus proche (embedding du titre), MGI + bande + confiance, phase, note de faisabilité, 5 frustrations principales, vidéos concurrentes, boutons « Générer 5 angles », « Sauver », « Marquer en production », « Ouvrir dans TubLyTI ».
  - Chaîne suivie : médiane de vues, rythme, 5 dernières vidéos avec score d'outlier, 3 chaînes similaires, niche.
  - Chaîne inconnue : aperçu (1 appel API) et boutons « Suivre » ou « Ajouter aux candidates » (alimente la découverte de la phase 10 bis).
  - Recherche YouTube : sujets TubLyTI correspondant à la requête, phase et MGI ; bouton « Créer ce sujet ».
- **API dédiée** `app/api/ext/*` : authentification par jeton personnel (Réglages → « Connecter l'extension »), CORS limité à l'origine `chrome-extension://<id>`, validation Zod, cache 10 min par vidéo pour économiser le quota (1 unité par vidéo inconnue).
- **Distribution** : « Charger l'extension non empaquetée » pour l'usage interne ; Chrome Web Store (frais uniques de 5 $, revue 1 à 7 jours) seulement au passage en SaaS.
- **Porte** : sur 10 vidéos de tes niches, le badge s'affiche en < 1 s ; « Suivre cette chaîne » ajoute la chaîne et elle apparaît dans TubLyTI ; aucune erreur dans la console du service worker.

## Phase 13 — Production et contrôle qualité (1 session)

- Si pas encore fait : déploiement Vercel (phase 6 du plan V1), domaine, variables de prod, crons, URL autorisées Supabase.
- Audit sécurité (P12 du plan V1) étendu aux routes `/api/ext/*`, jetons API, CORS.
- Tests de bout en bout Playwright sur 5 parcours : connexion, Aujourd'hui → sujet → angles → pipeline, ajout de chaîne, réglages des poids, extension (panneau sur une vidéo).
- **Porte** : 7 jours d'usage réel sans bug bloquant ; Lighthouse ≥ 90 partout en production.

## Hors périmètre (décidé après l'étude concurrentielle)

| Ne pas construire | Pourquoi |
| --- | --- |
| Overlays injectés dans le HTML de YouTube | Première cause de pannes chez NexLev, TubeBuddy, vidIQ, Viewstats |
| Générateur de miniatures IA | Terrain de 1of10, coût d'inférence récurrent, sans lien avec l'écart de marché |
| Script, voix, vidéo | Terrain de Subscribr et vidIQ ; c'est le rôle de Vrily, TubLyTI s'arrête au brief |
| A/B test de titres et miniatures | Nécessite l'écriture sur la chaîne et beaucoup de trafic |
| Score SEO et volume par mot-clé | Données coûteuses, la découverte YouTube passe surtout par l'accueil et les suggestions |
| Coach IA qui agit tout seul | Source des pires avis sur vidIQ ; le MCP dans Claude joue ce rôle à la demande |
| Gamification (badges, séries) | Aucune preuve d'efficacité dans le secteur |

Pour le futur SaaS : forfait pour la navigation et crédits réservés à l'IA (ne pas facturer chaque recherche comme OutlierKit), rappel avant renouvellement et annulation en un clic.
