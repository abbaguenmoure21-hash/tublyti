# ERGONOMIE.md — Comment l'application doit se manier

Ce fichier fait autorité pour la structure des écrans et les parcours, avec `DESIGN.md` (visuel) et `LEXIQUE.md` (mots). Maquettes de référence : `design/mockups/Sujets.dc.html`, `Tri.dc.html`, `MesVideos.dc.html`, `Veille.dc.html`, `Bienvenue.dc.html`, `SujetsMobile.dc.html`.

## Le constat

- **Trop d'écrans pour une seule décision.** Pour choisir un sujet, il fallait passer par 4 pages : Aujourd'hui, Matrice, Frustrations et la fiche sujet. Avec Validation, Pipeline, Activité, Chaînes, Ma chaîne, Réglages et Jobs, le menu comptait 10 entrées.
- **On perd sa place.** Ouvrir un sujet fait quitter la liste. Il faut revenir en arrière, et on perd ses filtres.
- **La chaîne n'est pas un réglage global.** Il faut refiltrer « Wealth / Mind / AI » sur chaque page.
- **La validation des nouveaux sujets est une page cachée**, qu'on oublie, alors qu'elle devrait être une tâche de 2 minutes poussée au bon moment.
- **Aucun guide au premier lancement** : on arrive sur des listes de chiffres sans savoir quoi faire.

## Les principes

1. **Une décision = un écran.** L'utilisateur choisit un sujet, prépare une vidéo, suit ses résultats. Rien d'autre ne mérite une entrée de menu.
2. **On ne quitte jamais la liste.** La fiche d'un sujet s'ouvre dans un panneau à droite. On passe au sujet suivant avec ↓ ou J, sans perdre ses filtres.
3. **Le contexte est global.** Le sélecteur « Afficher : Toutes mes chaînes / Wealth / Mind / AI » est en haut de la barre latérale et filtre toutes les pages. Il est mémorisé.
4. **Une seule action principale par zone.** Dans le panneau sujet, c'est « Créer cette vidéo ». Le reste est secondaire.
5. **Les tâches viennent à l'utilisateur.** Les nouveaux sujets à trier s'affichent en bandeau en haut de « Sujets », avec un mode de tri rapide carte par carte.
6. **Tout se fait aussi au clavier** : J/K (suivant/précédent), Entrée (ouvrir), C (créer la vidéo), X (ignorer), G/F/R en mode tri (garder, fusionner, rejeter), ⌘K (recherche partout).
7. **Les filtres restent dans l'adresse** (`?moment=2&chaine=wealth`). Un lien partagé ou un retour arrière retrouve exactement la même vue.
8. **Rien n'est définitif sans retour possible.** Ignorer, fusionner ou déplacer peut s'annuler (bouton « Annuler » dans la notification, Ctrl+Z en mode tri).

## La nouvelle navigation : 3 espaces + aide

| Espace | Remplace | Contenu |
| --- | --- | --- |
| **Sujets** (accueil) | Aujourd'hui, Matrice, Validation, Frustrations | Vue **Liste** (par défaut) ou **Carte**. Panneau sujet à droite. Bandeau « X nouveaux sujets à trier » → mode Tri. Les questions du public sont dans chaque sujet, et un filtre « avec questions du public » remplace la page Frustrations. |
| **Mes vidéos** | Pipeline, Ma chaîne | Onglet **Tableau** (Idée → En production → Publiée → Mesurée ; une vidéo passe seule dans « Mesurée » 30 jours après sa publication) et onglet **Ma chaîne** (chiffres publics de la chaîne choisie, et avec YouTube Analytics connecté : durée de visionnage, abonnés, trafic, pays, appareils, âge et genre, revenus, RPM, CPM). |
| **Veille** | Activité, Chaînes, Chaînes candidates | Onglets **À voir cette semaine** (vidéos qui surperforment, nouvelles vidéos, changements de moment), **Chaînes suivies**, **Chaînes à valider**. |
| Aide (?) | — | La page Guide d'utilisation, et le parcours de bienvenue relançable. |
| Réglages | Réglages, Profil, Santé des données | Santé des données devient un onglet des Réglages, visible pour l'administrateur uniquement. |

Sur mobile : barre du bas à 4 entrées (Sujets, Mes vidéos, Veille, Réglages). Le panneau sujet devient une feuille plein écran qu'on ferme en la glissant vers le bas.

Les anciennes adresses redirigent vers les nouvelles :
- `/today` et `/dashboard` → `/sujets`
- `/topics/review` → `/sujets/tri`
- `/frustrations` → `/sujets?questions=1`
- `/pipeline` et `/my-channel` → `/videos`
- `/activity` et `/channels` → `/veille`

## Les parcours clés (nombre de clics)

| Parcours | Avant | Après |
| --- | --- | --- |
| Choisir un sujet et le mettre en production | 5 à 7 clics, 3 pages | **2 clics** : clic sur la ligne, puis « Créer cette vidéo » |
| Comparer les 5 meilleurs sujets | 5 allers-retours entre liste et fiche | **0 changement de page** : ↓ dans le panneau |
| Trier les nouveaux sujets | Aller sur Validation (si on y pense) | Bandeau visible, puis 1 touche par sujet |
| Voir le résultat d'une vidéo publiée | Ma chaîne, puis chercher la vidéo | La carte « Publiée » affiche vues et écart |
| Premier lancement | Aucun guide | 3 étapes : niches → chaînes → premier sujet |

## Le panneau sujet (contenu, dans l'ordre)

1. La chaîne et la niche, le titre du sujet, l'étiquette de moment et la fiabilité.
2. « Pourquoi ce sujet » : une phrase avec le potentiel et le nombre de vidéos existantes.
3. « Ce que réclame le public » : les 3 commentaires les plus likés.
4. « Angles proposés » : un choix unique, le premier présélectionné.
5. Le bouton principal « Créer cette vidéo », qui crée la carte dans Mes vidéos avec l'angle choisi. Les boutons secondaires sont « Voir la fiche complète » et « Ignorer ce sujet ».

## États obligatoires

Chaque bloc de données a un squelette de chargement, un état vide et un état d'erreur. L'état vide propose toujours une action, par exemple :
- « Aucun sujet en “C'est le moment” pour cette chaîne. Voir ceux qui montent » ;
- « Aucune vidéo en cours. Choisis un sujet ».

## Mise en œuvre (ordre)

1. Barre latérale à 3 espaces, sélecteur de chaîne global (cookie et paramètre d'adresse), redirections des anciennes adresses.
2. Page Sujets : liste, filtres dans l'adresse, panneau sujet, raccourcis clavier, vue Carte (réutilise la matrice actuelle).
3. Mode Tri (réutilise les actions de `/topics/review`).
4. Mes vidéos : tableau et résultats (fusion de `/pipeline` et `/my-channel`).
5. Veille : trois onglets (fusion de `/activity`, `/channels` et des chaînes candidates).
6. Parcours de bienvenue au premier lancement (enregistré dans les réglages utilisateur), relançable depuis Aide.

## Espace client et console d'administration (règle permanente)

TubLyTI est un produit pour des clients, pas un outil interne. Deux mondes séparés :

| | Client | Console d'admin (rôle `admin` dans `profiles`) |
|---|---|---|
| Voit | Ses chaînes (`user_channels`) et les thématiques qu'il suit (`user_niches`) | Tout le catalogue |
| Sujets | Liste, Carte, Questions du public, filtrées sur ses thématiques ; « Ignorer » ne touche que lui (`user_topic_state`) | Validation des sujets proposés (garder, fusionner, rejeter) : `/admin/sujets` |
| Vidéos | Les siennes (`angles.user_id`) | — |
| Réglages | Mes chaînes, Thématiques à explorer, Alertes, Résumé du dimanche, Connexion à Claude (jetons), Profil, Apparence | Calcul du potentiel, Niches, Budget IA : `/admin/reglages` |
| Autres | Veille : « À voir cette semaine » | Collecte, Couverture et quota, Chaînes analysées et candidates, Clients, Liste d'attente |

Règles : une page client appelle `requireUser()` puis `resolveScope(db, user.id)` et ne lit jamais hors de `nicheIds`. Une page de la console est sous `/admin` (ou `/channels`) et protégée par un layout `requireAdmin()`. Une server action qui modifie des données communes appelle `assertAdmin()` ou `getAdminOrNull()`. Les angles proposés par TubLyTI ont `user_id` nul (communs) ; une vidéo de client a toujours son `user_id`.

Favoris, alertes et jetons d'accès appartiennent à un compte (`user_id`, migration 00019). Un jeton client ne voit que les thématiques de son compte (MCP et extension) ; les outils qui touchent au catalogue ou coûtent de l'IA (`generate_angles`, `add_candidate_channel`, suivi de chaîne) sont réservés aux jetons administrateur. Le résumé du dimanche part à chaque compte ayant une chaîne.

## Ajout d'une chaîne client (Réglages › Mes chaînes, Bienvenue)

Trois temps : 1) le client colle un lien (chaîne, @pseudo ou vidéo) et TubLyTI lit la chaîne sur YouTube (nom, photo, abonnés, vidéos) ; 2) il choisit la thématique (plusieurs chaînes peuvent partager une thématique) ; 3) il prouve qu'elle est à lui en collant un code `TUBLYTI-XXXX-XXXX` dans la description, puis « Vérifier ». Une chaîne non vérifiée n'apparaît ni dans « Afficher » ni dans les jetons d'accès. Une chaîne YouTube ne peut être vérifiée que par un seul compte. À la vérification, la chaîne rejoint les chaînes analysées et ses 50 dernières vidéos sont importées (Résultats immédiats). Code : `lib/youtube/channel-lookup.ts`, `lib/actions/compte.ts`, migration 00021.

Deux façons de prouver la propriété, au choix du client : « Avec Google » (OAuth `youtube.readonly`, liste des chaînes du compte, jeton révoqué aussitôt, rien d'enregistré côté Google ; routes `app/api/youtube/connect` et `callback`, cookie signé 15 min) ou « Avec un lien » (code dans la description). Le bouton Google n'apparaît que si `GOOGLE_OAUTH_CLIENT_ID` et `GOOGLE_OAUTH_CLIENT_SECRET` sont définis. Page publique `/confidentialite` exigée par Google.

## Page « Ma chaîne »

Une chaîne vérifiée à la fois (celle de « Afficher », sinon un choix). Deux blocs : 1) **Statistiques YouTube Analytics** (période 7 j / 28 j / 90 j / 12 mois, chiffres officiels, revenus réels si la chaîne est monétisée), après accord Google, jeton chiffré, bouton Déconnecter ; 2) **Chiffres publics** calculés sans accès au compte : vues habituelles (médiane), interactions, rythme, meilleur jour, Shorts contre vidéos longues, vues par mois, vidéos qui ont décollé (≥ 2× la médiane), revenus estimés (vues longues × RPM de la thématique, toujours présentés comme une estimation). « Mettre à jour » relit la chaîne sur YouTube (3 unités, une fois par heure). Code : `lib/youtube/public-stats.ts`, `lib/youtube/analytics.ts`, `lib/actions/analytics.ts`, migration 00023.

## Validation automatique (migration 00024)

- **Sujets proposés** : publiés chaque nuit sans intervention dès qu'ils ont au moins 5 vidéos venant d'au moins 3 chaînes, sans chaîne qui dépasse 50 % des vidéos. Un doublon d'un sujet publié de la même niche (ressemblance ≥ 92 %) est fusionné dedans. Les autres attendent ; ceux restés sous 5 vidéos 21 jours sont fermés. Seuls les sujets sensibles restent à valider à la main. Code : `lib/topics/auto-validate.ts`, appelé par l'étape de nuit « quality-gates ».
- **Chaînes candidates** : chaque nuit, TubLyTI lit leurs 30 dernières vidéos (2 à 3 unités de quota), compare leurs titres (hors Shorts d'abord) au centre de chaque niche et retient la plus proche. Les seuils sont recalibrés chaque nuit sur les chaînes déjà au catalogue (20e centile). Format : il suffit de 2 vidéos de plus de 3 min sur les 30 dernières ; une grosse chaîne (≥ 100 000 abonnés ou ≥ 50 000 vues habituelles) n'est jamais écartée pour son format et son seuil de niche est assoupli. Une chaîne écartée pour sa taille ou son format est relue 30 jours plus tard. Décision : ajoutée au catalogue ou écartée, avec la raison visible dans Chaînes candidates › Décisions automatiques récentes. Code : `lib/youtube/candidate-niche.ts`, appelé par l'étape « auto-triage ».
- Réglages possibles (variables) : `TOPIC_AUTO_MIN_VIDEOS`, `TOPIC_AUTO_MIN_CHANNELS`, `TOPIC_AUTO_MAX_CHANNEL_SHARE`, `TOPIC_AUTO_MERGE_SIM`, `CANDIDATE_MIN_SUBS`, `CANDIDATE_MIN_MEDIAN_VIEWS`, `CANDIDATE_MIN_LONG_VIDEOS`, `CANDIDATE_MIN_MARGIN`, `CANDIDATE_LONG_MIN_SECONDS`, `CANDIDATE_RECENT_VIDEOS`, `CANDIDATE_BIG_SUBS`, `CANDIDATE_BIG_MEDIAN_VIEWS`, `CANDIDATE_RECHECK_DAYS`.
- Rattrapage ou essai : `pnpm auto-validate` (simulation) puis `pnpm auto-validate --apply`.

## Niches créées automatiquement (migration 00025)

Une bonne chaîne candidate (taille et format suffisants) qui ne ressemble à aucune niche suivie n'est plus écartée : elle passe « hors niche ». Chaque nuit, ces chaînes sont regroupées par ressemblance ; dès que 3 forment un groupe cohérent, une niche est créée (nom, catégorie et fourchette de RPM proposés par Claude Haiku, ~0,002 $ par niche, 2 niches par nuit au plus, dans la limite d'`AI_BUDGET_USD`) et ces chaînes rejoignent le catalogue. Si l'IA reconnaît une niche existante, elles y sont rattachées. Un groupe incohérent (vlogs, musique…) est écarté. Une chaîne restée hors niche 90 jours sans voisines est écartée. Les niches créées ainsi apparaissent en tête de Console d'admin › Niches et calcul. Code : `lib/youtube/niche-create.ts`. Réglages : `NICHE_AUTO_MIN_CHANNELS`, `NICHE_AUTO_MAX_PER_NIGHT`, `NICHE_AUTO_EXPIRE_DAYS`, `NICHE_AUTO_AI` (false = nom tiré des titres, sans IA).

## Classement des chaînes : profil complet et IA (migration 00026)

Toutes les niches comptent (actualité, cuisine, méditation, toute langue) : une chaîne n'est jamais écartée pour son sujet, seulement pour sa taille ou son format. Pour la classer, TubLyTI lit son profil complet au même coût de quota : description et mots-clés de la chaîne, catégories YouTube (topicDetails), tags les plus fréquents, titres et début des descriptions des 30 dernières vidéos. Les transcriptions des vidéos d'autres chaînes ne sont pas accessibles par l'API officielle de YouTube.
- Sans IA : profil + titres transformés en vecteur, comparés au centre de chaque niche ; sans niche nette, la chaîne attend des chaînes semblables pour créer une niche.
- Avec `CANDIDATE_AI_CLASSIFY=true` : Claude Haiku lit le profil et choisit une niche existante ou en propose une nouvelle (nom, catégorie, RPM). La niche proposée est créée dès que 2 chaînes la partagent, ou tout de suite pour une grosse chaîne. Coût ≈ 0,002 $ par chaîne classée, dans la limite d'`AI_BUDGET_USD`.
- Reclasser les chaînes déjà ajoutées : `pnpm review-auto-channels --apply` puis `pnpm auto-validate --chaines --apply`.

## Impressions et CTR des miniatures (migration 00027)

À la connexion de YouTube Analytics, TubLyTI crée une tâche de rapport `channel_reach_basic_a1` (YouTube Reporting API, déjà couverte par l'accès `yt-analytics.readonly`). YouTube dépose un fichier par jour (premier fichier sous 48 h, 30 jours d'historique rattrapés). L'étape de nuit « Impressions et CTR des miniatures » (`reach`, sans quota Data API) les importe dans `video_reach_daily`. Affichage : colonnes Impressions et CTR du tableau « Meilleures vidéos » de Ma chaîne ; MCP : `get_video_performance.thumbnail`. Code : `lib/youtube/reporting.ts`.
