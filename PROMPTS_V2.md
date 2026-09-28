# PROMPTS_V2.md — TubLyTI V2 (fluidité, design, fonctionnalités, MCP, extension)

À coller dans Claude Code, dans l'ordre, une session par prompt. Ordre d'exécution : P15 → P27, puis P29 → P35, puis P28 (contrôle qualité) en dernier. Rituel inchangé : l'agent lit les fichiers, propose un plan court, tu valides, il code, il te montre, tu testes dans le navigateur avant le prompt suivant. Après chaque prompt : `pnpm lint && pnpm test && pnpm build` doivent passer, puis commit.

---

## P15 — Lecture et plan V2

Tu es le CTO et Lead Developer de TubLyTI. Le produit V1 fonctionne (phases 1 à 5). On attaque la V2. Lis intégralement CLAUDE.md, AI_RULES.md, ARCHITECTURE.md, puis les deux nouveaux fichiers DESIGN.md (système de design, fait autorité pour tout le visuel) et PLAN_V2.md (phases 8 à 13 et audit A1 à A10).

Vérifie dans le code chacun des 10 problèmes de l'audit (A1 à A10) : confirme-le avec le fichier et la ligne, ou dis-moi s'il n'existe plus. Puis présente-moi ton plan pour la phase 8 en 15 lignes maximum. Ne code rien avant ma validation.

---

## P16 — Corrections bloquantes (A1 à A5)

Corrige, avec un test Vitest pour chaque correction logique :

1. A1 — Résolution de niche partagée `lib/niches/resolve.ts` : accepte un nom, une catégorie (`finance`, `psychology`, `ai_tools`) ou un nom de chaîne (`Wealth Decoded`), insensible à la casse et aux accents ; en cas d'échec, renvoie la liste des niches disponibles. Utilise-la dans le MCP et dans toutes les API qui filtrent par niche.
2. A2 — Fonction `getLatestScoreDate()` : partout où l'on filtre `scored_at = today`, utilise la date du dernier calcul disponible et affiche « Scores du {date} » dans l'interface.
3. A3 — Route MCP : jeton uniquement dans l'en-tête `Authorization: Bearer`, comparaison `crypto.timingSafeEqual`, réponse 401 identique dans tous les cas d'échec.
4. A4 — `globals.css` : `--font-sans: var(--font-geist-sans)`, vérifie dans le navigateur que Geist est bien appliquée.
5. A5 — `app/layout.tsx` : `lang="fr"`, métadonnées `title: { default: 'TubLyTI', template: '%s · TubLyTI' }`, description en français, favicon SVG TubLyTI (pastille `#524fdd` + lettre T blanche), suppression des SVG Next/Vercel inutilisés de `public/`.

---

## P17 — Fluidité : Server Components, cache et navigation instantanée (A6, A7)

Objectif : plus aucun écran blanc ni rechargement inutile.

- Convertis chaque page de `app/(app)` en Server Component qui lit Supabase côté serveur via des fonctions de `lib/queries/*` (une par écran, typées). Les parties interactives (graphique, filtres, boutons, formulaires) deviennent de petits Client Components qui reçoivent les données en props.
- Ajoute un `loading.tsx` par route, avec des squelettes qui ont exactement la forme du contenu final, et découpe les pages lourdes (sujet, matrice) en blocs `<Suspense>` indépendants pour un affichage progressif.
- Mutations (valider un sujet, corriger un label, générer des angles, marquer en production, ajouter une chaîne) en Server Actions, avec `useOptimistic` pour un retour immédiat, `revalidatePath` ciblé et toasts `sonner` (succès et erreur en français).
- Filtres dans l'URL avec `nuqs` : niche, océan bleu, tri, phase. Le bouton retour du navigateur restaure l'état.
- Lignes de tableau cliquables en entier (`<Link>`), préchargement au survol.
- Supprime les routes `/api/*` devenues inutiles pour l'interface ; garde celles utilisées par les crons, le MCP et plus tard l'extension.

Critère de fin : `grep -rn "useEffect" app/\(app\)` ne renvoie plus aucun chargement de données ; mesure Lighthouse sur /dashboard en build de production et donne-moi les scores.

---

## P18 — Design system clair (A8, A9)

Applique DESIGN.md à la lettre.

- Remplace intégralement les variables de `globals.css` par le bloc de référence de DESIGN.md (thème clair par défaut) et ajoute le thème sombre décrit ; expose les tokens `primary-soft`, `primary-ink`, `success`, `warning`, `phase-0…3`, `phase-*-soft`, `phase-*-ink` dans `@theme inline`.
- Crée dans `components/tublyti/` : `PhaseBadge`, `MgiScore` (chiffre + mini-jauge de l'échelle séquentielle), `KpiCard`, `PageHeader` (titre-question + sous-titre + actions), `EmptyState`, `ErrorState`, `DataTable` (tri par colonne, en-tête collant, lignes de 44 px, navigation `j`/`k`/`Entrée`).
- Remplace dans toutes les pages les couleurs codées en dur et les badges ad hoc par ces composants. Critère : `grep -rnE "#[0-9a-fA-F]{6}|oklch\(" app components --include=*.tsx` ne renvoie plus rien.
- Corrige tous les textes de l'interface : accents, typographie française, titres de page en forme de question (voir la section Rédaction de DESIGN.md). Donne-moi la liste des textes modifiés.
- Graphiques Recharts : couleurs de phase via les variables CSS, quadrant océan bleu teinté, palette catégorielle des signaux de DESIGN.md, infobulles au style popover.
- Supprime `sidebar-glow` et toute animation en boucle hors page de connexion ; respecte `prefers-reduced-motion`.

---

## P18-bis — Reproduire les maquettes validées

Les maquettes validées sont dans `design/mockups/` : `Main.dc.html` (Aujourd'hui), `Matrice.dc.html`, `Sujet.dc.html`, `Extension.dc.html` (panneau latéral de l'extension), `Mobile.dc.html`. Ce sont des fichiers de référence visuelle (HTML statique avec données d'exemple), pas du code à copier tel quel.

Pour chaque écran, reproduis fidèlement la mise en page, la hiérarchie, les espacements, les tailles de texte et les couleurs, en utilisant les tokens de DESIGN.md et les composants de `components/tublyti/` (jamais de couleurs en dur), avec les vraies données de la base. Points précis à respecter :
- Aujourd'hui : barre supérieure (recherche ⌘K + état de la collecte), titre-question, 4 KPI, 3 colonnes par chaîne avec 3 sujets chacune (badge de phase, jauge MGI, citation de frustration, boutons Voir / En production), puis « Depuis ta dernière visite » et « En production ».
- Matrice : sélecteur de chaîne segmenté, filtres de phase en pastilles, nuage de points avec quadrant océan bleu étiqueté, panneau d'aperçu du sujet sélectionné à droite (clic sur un point), tableau trié par MGI avec mini-courbe de tendance.
- Sujet : en-tête avec badge de phase et contexte (« ouverte depuis N jours »), 4 actions dont « Générer 5 angles » avec le coût, 5 cartes de composantes du MGI, courbes de signaux, liste des frustrations avec l'angle demandé, angles proposés (un « Retenu »), concurrents avec étiquette Qualifiée / Ancienne / Hors sujet / Short.
- Mobile : barre supérieure, sélecteur de chaîne, cartes empilées, barre d'onglets en bas (Aujourd'hui, Matrice, Pipeline, Plus).
Montre-moi une capture de chaque écran à côté de la maquette avant de conclure.

---

## P19 — Navigation : barre latérale claire, mobile, thème (A10)

- Barre latérale claire de 240 px (DESIGN.md), repliable à 64 px avec infobulles, état mémorisé (cookie, pour éviter le saut au chargement).
- Sous 768 px : barre latérale remplacée par une barre supérieure (logo, titre de page, bouton menu) qui ouvre un `Sheet`.
- Sélecteur de thème Clair / Sombre / Système avec `next-themes`, dans le menu utilisateur en bas de la barre latérale.
- Ordre du menu : Aujourd'hui, Matrice, Pipeline, Frustrations, Validation, Chaînes ; puis en bas Réglages, Jobs. (Aujourd'hui, Pipeline et Réglages seront créés aux prompts suivants : ajoute les entrées maintenant avec des pages « Bientôt ».)
- Teste à 375, 768 et 1440 px de large et montre-moi une capture de chaque.

---

## P20 — Page « Aujourd'hui »

Crée `/today`, qui devient la page d'accueil après connexion.

- En-tête : « Quoi tourner cette semaine ? », date des scores, état des crons en une ligne (vert si les 3 jobs de la nuit ont réussi, sinon lien vers Jobs).
- Une colonne par chaîne (Wealth Decoded, Mind Unlocked, AI Unchained) : les 3 meilleurs sujets (phase 2 en priorité, puis MGI), chacun avec `PhaseBadge`, `MgiScore`, la frustration la plus likée en citation, et deux boutons « Voir » et « En production ».
- Bloc « Depuis ta dernière visite » : nouveaux sujets, sujets qui ont changé de phase (avec flèche ancienne → nouvelle), alertes burn-down. Stocke la date de dernière visite par utilisateur.
- Bloc « En cours » : sujets en production avec leur âge en jours.
- États vide, chargement et erreur soignés.

---

## P21 — Palette de commandes et raccourcis clavier

- Palette `⌘K` / `Ctrl+K` avec `cmdk` : recherche instantanée des sujets (label), niches, chaînes et pages ; actions « Générer des angles pour… », « Ajouter une chaîne », « Marquer en production… », « Changer de thème ».
- Raccourcis globaux : `g t` Aujourd'hui, `g m` Matrice, `g p` Pipeline, `g f` Frustrations, `/` ouvrir la recherche, `?` fenêtre d'aide listant tous les raccourcis. Désactivés quand le focus est dans un champ.
- Sur la page Sujet : `a` générer des angles, `p` passer en production, `c` copier le brief.
- Accessible : navigation complète au clavier, annonces ARIA.

---

## P22 — Pipeline de production

Crée `/pipeline`, un kanban à 4 colonnes : Idée, En production, Publiée, Mesurée.

- Une carte = sujet + angle retenu + chaîne + âge. Glisser-déposer (`@dnd-kit`), avec mise à jour optimiste et annulation en cas d'erreur.
- Passage à « Publiée » : fenêtre demandant l'URL YouTube ; validation par l'API YouTube (1 unité) ; enregistre `angles.video_id`.
- Passage automatique à « Mesurée » à J+30 par le cron `score` : vues à J+30 comparées à la médiane des 20 dernières vidéos de la chaîne, affichées sur la carte (`+42 % vs médiane`, vert ou rouge).
- Filtre par chaîne. Données alimentant le prompt de calibration P14.
- Boucle de calibration visible : à chaque passage en « Mesurée », enregistre le MGI, la phase et la note de faisabilité au moment du choix. Dans Réglages → Scoring, affiche le **taux de réussite du MGI** (part des vidéos au-dessus de la médiane de leur chaîne, par tranche de MGI) et propose un ajustement des poids, appliqué seulement après validation.
- Le pipeline s'arrête au brief : aucune écriture de script ni production vidéo dans TubLyTI (ce rôle revient à Vrily). Bouton « Envoyer le brief » = copie Markdown + export .md.

---

## P23 — Collections, brief exportable, réglages

1. **Collections (swipe file)** : sauvegarde en un clic (icône signet au survol) de sujets, vidéos, chaînes, frustrations et angles dans des collections nommées (« Idées Wealth Q4 », « Titres à imiter »…), avec note libre par élément. Collection par défaut « Favoris ». Filtre « Dans une collection » sur la matrice et dans la palette ⌘K. Table `collections` + `collection_items` (type, ref_id, note), RLS.
2. Brief Markdown complet (remplacé et enrichi par le dossier de P35) : sujet, phase, MGI et ses composantes, angle choisi, 10 frustrations sources (texte + likes + lien vers le commentaire), 5 vidéos concurrentes (titre, vues, lien), date. Boutons « Copier » et « Télécharger .md ».
3. Page `/settings` avec onglets :
   - Scoring : curseurs des poids du MGI et des seuils ; aperçu du top 10 recalculé avant d'enregistrer ; bouton « Revenir aux valeurs par défaut ».
   - Niches : liste éditable (nom, catégorie, coefficient RPM, chaîne liée, sites Stack Exchange, requêtes).
   - Accès API : création/révocation de jetons (lecture seule ou lecture/écriture), affichés une seule fois, stockés hachés (table `api_tokens` avec RLS).
   - Apparence : thème.

---

## P24 — Digest du dimanche

Ajoute un envoi Resend chaque dimanche à 06:00 UTC (cron Vercel) : par chaîne, les 5 meilleurs sujets, les sujets passés en phase 2 dans la semaine, les vidéos publiées et leur résultat à J+30. Email sobre (DESIGN.md en version email : fond blanc, titre, listes, un seul bouton « Ouvrir TubLyTI »). Ajoute un bouton « M'envoyer le digest maintenant » dans Réglages.

---

## P25 — MCP v2

Refonds `lib/mcp/server.ts` selon PLAN_V2.md, phase 11.

- API `registerTool` avec `title`, `description` précise (quand l'utiliser), annotations `readOnlyHint` / `destructiveHint` / `idempotentHint`, `inputSchema` Zod et `outputSchema` ; chaque réponse contient une sortie structurée et un texte lisible en français.
- Positionnement : ne pas rivaliser avec les 60+ outils « bruts » de NexLev ou vidIQ ; exposer la **synthèse** que personne d'autre n'a (écart, phase, frustrations, faisabilité).
- Outils de lecture : `list_niches`, `list_today` (le flux Aujourd'hui), `list_opportunities` (niche par nom, catégorie ou chaîne ; dernier score disponible ; filtres phase et faisabilité), `search_topics` (sémantique : embedding Voyage en `input_type: "query"`, pgvector), `get_topic_gap` (MGI décomposé + bande + confiance + fraîcheur), `get_topic_phase` (phase, historique, date d'ouverture de la fenêtre), `list_frustrations` (avec citations, likes, liens), `get_niche_dossier` (le dossier de P35 en Markdown), `channel_outliers` (outliers datés de P30, filtre taille de chaîne), `similar_channels` (P32).
- Outils d'écriture : `generate_angles` (coût estimé annoncé dans la description, refus si budget IA atteint), `save_to_collection`, `create_pipeline_card`, `mark_published`, `add_candidate_channel`.
- Plafonds quotidiens par outil et par jeton (table `api_usage`), réinitialisés à minuit UTC, message clair quand un plafond est atteint.
- Ressource `tublyti://brief/today` et prompt MCP `plan_my_week`.
- Authentification par les jetons de la table `api_tokens` : un jeton lecture seule ne peut appeler que les outils `readOnlyHint: true`.
- Teste avec l'inspecteur MCP (`npx @modelcontextprotocol/inspector`) et donne-moi la configuration exacte à ajouter comme connecteur personnalisé dans Claude (URL + en-tête).

---

## P26 — Extension Chrome : squelette et API

Lis la phase 12 de PLAN_V2.md.

- Crée `extension/` comme package du workspace pnpm avec WXT (Manifest V3, React, Tailwind, tokens partagés de DESIGN.md).
- Permissions : `sidePanel`, `storage`, `tabs` ; `host_permissions` : `https://www.youtube.com/*` et l'URL de TubLyTI (variable de build). Aucun script de contenu, aucune lecture du HTML de YouTube.
- Service worker : écoute les changements d'URL des onglets YouTube, extrait le type de page (vidéo, chaîne, recherche) et l'identifiant, appelle l'API, met à jour le badge (texte `P0`–`P3`, couleur de phase ; gris `+` si inconnu). Anti-rebond 500 ms, cache `chrome.storage.session` 10 min.
- Côté TubLyTI : routes `app/api/ext/lookup` (vidéo, chaîne, recherche), `app/api/ext/track-channel`, `app/api/ext/topic-action` ; authentification par jeton `api_tokens`, CORS limité à `chrome-extension://<EXTENSION_ID>`, validation Zod, cache serveur 10 min par vidéo ; pour une vidéo inconnue, 1 appel `videos.list` puis sujet le plus proche par embedding du titre.
- Page d'options de l'extension : URL de TubLyTI + jeton ; bouton « Tester la connexion ».
- Donne-moi la procédure pour charger l'extension non empaquetée dans Chrome.

---

## P27 — Extension Chrome : panneau latéral

Construis le panneau latéral selon PLAN_V2.md :

- Vidéo : score d'outlier daté de la vidéo (P30) avec son explication, sujet (ou « sujet le plus proche », avec score de similarité), `PhaseBadge`, `MgiScore` avec bande et confiance, note de faisabilité A–F pour la chaîne concernée, 5 frustrations, 3 concurrents, boutons « Générer 5 angles », « Sauver dans une collection », « En production », « Ouvrir dans TubLyTI ».
- Chaîne suivie : médiane de vues, rythme de publication, 5 dernières vidéos avec leur score d'outlier, 3 chaînes similaires (P32), niche.
- Chaîne inconnue : aperçu (abonnés, médiane estimée sur les 10 dernières vidéos, 1 appel API) et boutons « Suivre » (choix de la niche) ou « Ajouter aux candidates » (file de P32).
- Recherche : sujets correspondant à la requête ; « Créer ce sujet ».
- Pages non YouTube : message court et lien vers TubLyTI.
- Mêmes composants visuels que l'application, largeur 360 px, squelettes, erreurs claires (jeton invalide, hors ligne, quota atteint).
- Raccourci clavier `Alt+T` pour ouvrir le panneau.

---

## P29 — Confiance, fraîcheur et coûts IA visibles

Objectif : que chaque chiffre soit crédible et que chaque dépense soit choisie.

1. **Bandes du MGI** : 5 bandes affichées partout à côté du chiffre (Très faible < 20, Faible 20–39, Moyen 40–59, Fort 60–79, Très fort ≥ 80), couleurs de l'échelle séquentielle de DESIGN.md.
2. **Confiance** par sujet : Élevée / Moyenne / Faible, calculée à partir du nombre de commentaires analysés, du nombre de sources de demande présentes (Trends, vues, HN, Stack Exchange) et de l'âge des données. Infobulle qui donne la raison (« Faible : 38 commentaires seulement, pas de données Trends »). Stocke `confidence` et `confidence_reason` dans `topic_scores`.
3. **Fraîcheur** : « mis à jour il y a 6 h » sur chaque score, bandeau discret si les données ont plus de 36 h.
4. **RPM honnête** : afficher une fourchette (ex. 8–14 $) et sa source (niche, format, tes propres chiffres YouTube Studio si saisis) au lieu d'un coefficient seul.
5. **Coûts IA** : table `ai_spend` (date, action, modèle, tokens, coût). Avant toute génération payante (angles, analyse de titres, dossier), fenêtre de confirmation avec le coût estimé et le budget restant du mois. Jauge du budget dans Réglages, historique des dépenses, aucune action IA déclenchée sans clic explicite.

---

## P30 — Score d'outlier daté et filtre de taille de chaîne

1. Pour chaque vidéo suivie, calcule un **score d'outlier daté** : vues de la vidéo à l'âge N jours ÷ médiane des vues des 10 vidéos précédentes de la même chaîne **au même âge** (à partir de `video_snapshots`). Si l'historique manque, repli sur la médiane actuelle des 10 vidéos précédentes, marqué « approximatif ». Table `video_outliers` (video_id, score, baseline, age_days, method).
2. Infobulle partout où le score apparaît : « 12× la médiane des 10 vidéos précédentes, à 7 jours d'âge ».
3. Badges colorés à seuil réglable (≥ 3×, ≥ 5×, ≥ 10×) en utilisant l'échelle séquentielle (pas les couleurs de phase).
4. **Filtre taille de chaîne** (< 10 k, 10–50 k, 50–250 k, > 250 k abonnés) sur la matrice, les listes d'outliers et le MCP ; vue « Outliers de petites chaînes » (≤ 50 k) dans la page Frustrations/Outliers.
5. Tests Vitest sur le calcul (âge égal, historique manquant, chaîne de moins de 10 vidéos).

---

## P31 — Flux d'activité des concurrents

1. À chaque collecte, compare titre et URL de miniature de chaque vidéo suivie avec le snapshot précédent ; enregistre les changements dans `video_changes` (type : title | thumbnail, ancien, nouveau, date).
2. Événements : nouvel upload, changement de titre, changement de miniature, pic (vues par heure > 3× la médiane de la chaîne).
3. Page `/activity` : fil chronologique filtrable par type d'événement, par niche et par taille de chaîne ; pour un changement, affichage avant/après côte à côte et évolution des vues après le changement.
4. Les 3 événements les plus marquants de la veille remontent dans « Aujourd'hui ».

---

## P32 — Chaînes candidates et chaînes similaires

1. **Découverte** : une fois par semaine, pour les sujets en phase 1 ou 2, lance les requêtes YouTube associées (dans le budget des 100 recherches/jour, jamais plus de 30 par semaine pour cette tâche). Toute chaîne non suivie apparue dans les résultats entre dans `candidate_channels` avec : abonnés, médiane de vues des 10 dernières vidéos, vidéos par mois, et une **probabilité faceless** estimée par Claude Haiku à partir du titre, de la description et de 5 titres de vidéos (avec la raison).
2. Page `/channels/candidates` : file à valider (Suivre dans une niche / Ignorer), tri par médiane de vues et probabilité faceless. Les ajouts de l'extension (« Ajouter aux candidates ») arrivent dans la même file.
3. **Chaînes similaires** : embedding moyen des 20 derniers titres de chaque chaîne (Voyage), stocké dans `channels.embedding` ; les 5 plus proches affichés sur la fiche chaîne, dans le panneau de l'extension et via le MCP `similar_channels`.

---

## P33 — Note de faisabilité A–F pour tes chaînes

1. Dans Réglages, saisie de tes chaînes (Wealth Decoded, Mind Unlocked, AI Unchained) avec leur ID YouTube ; leurs statistiques sont collectées comme les autres.
2. Pour chaque sujet et la chaîne liée à sa niche, calcule une note A à F : compare tes abonnés et ta médiane de vues à celles des chaînes qui ont publié les vidéos qualifiées du sujet (écart médian, part de ces vidéos venant de chaînes de ta taille ou plus petites, âge de ces vidéos).
3. Affiche la note avec une phrase d'explication (« B : 4 des 10 vidéos qui marchent viennent de chaînes plus petites que la tienne »), dans Aujourd'hui, la matrice (filtre « A–B seulement »), la fiche sujet, l'extension et le MCP.
4. La page Aujourd'hui trie ses recommandations par combinaison MGI × faisabilité.

---

## P34 — Alertes personnalisées centrées sur les phases

1. Table `alert_rules` : types « un sujet de la niche X passe en phase 2 », « un sujet de ma collection change de phase », « vidéo > N× sur une chaîne < K abonnés », « fenêtre qui se ferme » (burn-down, déjà existant).
2. Évaluation dans le cron `score` ; les déclenchements sont enregistrés dans `alert_events`.
3. Livraison : regroupées dans le digest du dimanche par défaut ; e-mail immédiat en option par règle ; badge de notifications dans la barre supérieure.
4. Écran Réglages → Alertes pour créer, suspendre et supprimer des règles, avec un aperçu « cette règle se serait déclenchée 3 fois le mois dernier ».

---

## P35 — Formules de titres et dossier de niche

1. **Formules de titres** : pour chaque niche, analyse avec Claude Haiku (Batch) les titres des vidéos à score d'outlier ≥ 3× : structure (question, chiffre, « how I », « why », comparaison, défi), longueur, déclencheurs émotionnels. Stocke les 10 formules dominantes dans `title_patterns` avec des exemples. Affiche-les dans un onglet de la matrice.
2. Crée `lib/nlp/prompts/angles_v2.md` : le générateur d'angles reçoit en plus ces formules et doit indiquer pour chaque angle la formule utilisée et la frustration qu'il résout. Incrémente `PROMPT_VERSION`.
3. **Dossier exportable** (sujet ou niche) : MGI décomposé avec bande, confiance et fraîcheur ; phase et courbe ; note de faisabilité ; 10 frustrations avec citations et liens ; 5 concurrents qualifiés et chaînes exemples ; fourchette RPM ; formules de titres ; 5 angles. Export Markdown (copie + .md) et PDF (feuille d'impression dédiée avec la typographie de DESIGN.md). C'est aussi la sortie de l'outil MCP `get_niche_dossier`.

---

## Hors périmètre (décidé après l'étude concurrentielle)

Ne rien construire de ceci, même si c'est demandé en passant sans validation explicite : overlays injectés dans le HTML de YouTube, générateur de miniatures IA, écriture de scripts, voix ou vidéo (rôle de Vrily), A/B test de titres et miniatures, score SEO et volume de recherche par mot-clé, coach IA conversationnel qui agit tout seul, gamification (badges, séries).

---

## P28 — Contrôle qualité final

1. Audit sécurité complet (prompt P12 de la V1) étendu à : routes `/api/ext/*`, jetons API (hachage, révocation, portée lecture/écriture), CORS, permissions de l'extension.
2. Tests Playwright des 5 parcours de la phase 13 de PLAN_V2.md.
3. Lighthouse en production sur /today, /dashboard, /topics/[id] : Performance ≥ 90, Accessibilité ≥ 95.
4. Liste finale de ce qui reste imparfait, par ordre de gravité.
