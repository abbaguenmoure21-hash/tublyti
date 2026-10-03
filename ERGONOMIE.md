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
6. **Tout se fait aussi au clavier** : J/K (suivant/précédent), Entrée (ouvrir), C (créer la vidéo), X (ignorer), G/F/I en mode tri, ⌘K (recherche partout).
7. **Les filtres restent dans l'adresse** (`?moment=2&chaine=wealth`). Un lien partagé ou un retour arrière retrouve exactement la même vue.
8. **Rien n'est définitif sans retour possible.** Ignorer, fusionner ou déplacer peut s'annuler (bouton « Annuler » dans la notification, Ctrl+Z en mode tri).

## La nouvelle navigation : 3 espaces + aide

| Espace | Remplace | Contenu |
| --- | --- | --- |
| **Sujets** (accueil) | Aujourd'hui, Matrice, Validation, Frustrations | Vue **Liste** (par défaut) ou **Carte**. Panneau sujet à droite. Bandeau « X nouveaux sujets à trier » → mode Tri. Les questions du public sont dans chaque sujet, et un filtre « avec questions du public » remplace la page Frustrations. |
| **Mes vidéos** | Pipeline, Ma chaîne | Onglet **Tableau** (Idée → Script → Enregistrement et montage → Publiée) et onglet **Résultats** (vues à 7 et 30 jours, écart avec ta moyenne, note A–F). |
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
| Réglages | Mes chaînes, Thématiques à explorer, Profil, Apparence | Niches et calcul, Budget IA, Accès API, Alertes : `/admin/reglages` |
| Autres | Veille : « À voir cette semaine » | Collecte, Couverture et quota, Chaînes analysées et candidates, Clients, Liste d'attente |

Règles : une page client appelle `requireUser()` puis `resolveScope(db, user.id)` et ne lit jamais hors de `nicheIds`. Une page de la console est sous `/admin` (ou `/channels`) et protégée par un layout `requireAdmin()`. Une server action qui modifie des données communes appelle `assertAdmin()` ou `getAdminOrNull()`. Les angles proposés par TubLyTI ont `user_id` nul (communs) ; une vidéo de client a toujours son `user_id`.
