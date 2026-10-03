# PROMPTS_V2.md — TubLyTI V2 (fluidité, design, fonctionnalités, MCP, extension)

À coller dans Claude Code, dans l'ordre, une session par prompt. Ordre d'exécution : **P37 d'abord (qualité des données), puis P37-bis, puis P37-ter, puis P37-quater, puis P38 (déploiement)**, puis P15 → P17, puis **P36 (découverte) au plus tôt pour que la base grossisse pendant le reste du travail**, puis P18 → P27, P29 → P35, et P28 (contrôle qualité) en dernier. Rituel inchangé : l'agent lit les fichiers, propose un plan court, tu valides, il code, il te montre, tu testes dans le navigateur avant le prompt suivant. Après chaque prompt : `pnpm lint && pnpm test && pnpm build` doivent passer, puis commit.

---

## P37 — PRIORITÉ ABSOLUE : qualité des données (à faire avant toute autre fonctionnalité)

**Diagnostic chiffré du 2 oct. 2026 (`design/diagnostic.md`) — à traiter en premier :**

- **La collecte ne tourne plus depuis le 27 sept.** (dernier `collect` le 27, dernier `score` le 28) : l'application n'est pas déployée sur Vercel (aucun dossier `.vercel`), donc les crons de `vercel.json` ne s'exécutent jamais. → **Étape 0** : déployer sur Vercel (P13 du plan V1) avec les crons ; en attendant, un script `pnpm nightly` qui enchaîne collect → classify → score en local.
- **465 chaînes sur 541 n'ont jamais été vérifiées**, et les 3 niches d'exploration ont 0 vidéo. → Rattrapage : exécuter `collect` en boucle jusqu'à ce que toutes les chaînes aient un `last_checked_at` (coût ≈ 1 à 2 unités par chaîne ; chaque collecte n'utilise aujourd'hui que ~22 unités sur 10 000 disponibles par jour).
- **13 vidéos sur 3 085 seulement sont rattachées à un sujet.** Conséquence : pour les 78 sujets, offre = 0 et frustration = 0, donc le MGI n'est que la demande Google Trends × RPM. Le classement actuel ne veut rien dire. → Rattachement par embedding (point 5) appliqué en rattrapage à TOUTES les vidéos longues existantes, puis à chaque collecte.
- **Le MGI dépasse 100** (jusqu'à 175) : normaliser le score final sur 0–100 (percentile dans la niche) pour que les bandes de P29 aient un sens.
- **Seulement 1 470 commentaires classés sur 5 310**, dont 77 frustrations (5 %) et aucun rattaché à un sujet. → Classer tout le stock (Batch API, coût estimé affiché avant), puis ne collecter que sur les vidéos du point 6.
- **La migration `00014_quota_plan_and_coverage.sql` n'est pas appliquée** (`candidate_channels.auto_decision` absent) et `candidate_channels` est vide. → Appliquer toutes les migrations en attente et vérifier avec `supabase migration list`.
- **0 vidéo découverte par recherche** : confirme le bug de clé étrangère (point 2).
- **78 sujets `active` = les requêtes écrites à la main**, aucun validé. → Les repasser en `proposed` ; tu ne gardes en `active` que ceux que je valide.

Constat (audit du 2 oct. 2026) : les recherches ramènent des vidéos et chaînes sans intérêt, et il n'y a pas assez de données pour décider. Causes trouvées dans le code — vérifie chacune, puis corrige :

1. **`lib/youtube/search.ts`** : `order=date`, `maxResults=10`, 30 jours → on récupère les 10 vidéos les plus récentes sur un mot-clé, presque toujours de micro-chaînes. Et on paie 100 unités pour 10 résultats alors que 50 coûtent le même prix.
   → `order=relevance` (et une seconde passe `order=viewCount` une fois par semaine), `maxResults=50`, `videoDuration=medium` puis `long` (jamais de Shorts), `publishedAfter` = 180 jours pour mesurer l'offre, `regionCode=US`, `relevanceLanguage=en`. Puis un `videos.list` (1 unité / 50) pour récupérer vues, durée et chaîne de chaque résultat.
2. **Bug critique** : `search.ts` n'insère que des vidéos de chaînes NON suivies dans `videos`, alors que `videos.channel_id` référence `channels(id)` : chaque insertion viole la clé étrangère, l'erreur n'est pas vérifiée, **rien n'est enregistré**. L'offre concurrente (O_q) n'est donc mesurée que sur les chaînes suivies, et le MGI est faussé.
   → Nouvelle table `search_results` (topic_id, video_id, channel_id, title, views, duration_s, published_at, channel_subscribers, rank, searched_at), sans clé étrangère vers `channels`. O_q et le « click-through discrepancy » se calculent sur cette table. Vérifie et journalise l'erreur de CHAQUE écriture Supabase dans tout `lib/` (`if (error) throw/log`).
3. **Découverte de chaînes** (`discover-sources.ts`, `auto-triage.ts`) : les sources « tendances mostPopular » (Divertissement, Actualités…) et « auteurs de commentaires » ramènent des chaînes grand public hors niche ; les seuils de rejet (1 000 abonnés, 200 vues médianes) sont trop bas.
   → Supprime ces deux sources. Garde : recherche (point 1), `channelSections` des chaînes suivies, chaînes similaires (embeddings) et import manuel/vidIQ. Nouveaux seuils d'acceptation automatique : ≥ 4 vidéos longues sur 90 jours ET (≥ 10 000 abonnés OU médiane ≥ 5 000 vues) ET similarité ≥ 0,80 calculée sur les **10 derniers titres** de la chaîne (pas son nom) avec le centroïde de la niche. Rejet automatique sous 3 000 abonnés ET médiane < 1 000 vues, ou similarité < 0,65. Le reste en validation manuelle.
4. **Sujets** (`cluster-service.ts`) : un « sujet » est aujourd'hui le titre le plus court d'un groupe de 3 vidéos similaires, et `seed/queries.csv` contient des requêtes rédigées à la main, non validées.
   → Un sujet est proposé uniquement à partir de : (a) vidéos outliers (≥ 3×) de chaînes de qualité, (b) angles demandés dans les frustrations. Claude Haiku nomme le sujet en 2 à 6 mots anglais, génère 3 requêtes de recherche et rejette ce qui est hors niche. Statut `proposed` obligatoire, aucun sujet `active` sans validation. Ajoute un bouton « Archiver tous les sujets proposés sans vidéo qualifiée ».
5. **Rattachement vidéo → sujet** : toute vidéo rattachée à un sujet doit avoir une similarité ≥ 0,75 entre l'embedding de son titre et celui du sujet ; sinon, rattachement refusé.
6. **Commentaires** (`collect.ts` étape 4) : on prend toutes les vidéos de 60 jours (Shorts compris), sans tri fiable par vues (`video_snapshots[0]` non ordonné), avec 2 requêtes par vidéo (lent → le cron s'arrête à 5 min avant d'avoir collecté).
   → Une seule requête SQL (vue ou RPC) qui sélectionne les vidéos **longues (≥ 8 min), ≥ 10 000 vues, de chaînes suivies, rattachées à un sujet actif**, triées par vues décroissantes, et exclut celles dont les commentaires ont < 7 jours. 100 à 200 commentaires par vidéo, `order=relevance`.
7. **Nettoyage** : migration + script `scripts/cleanup-data.ts` (avec mode `--dry-run` qui affiche ce qui serait supprimé) : chaînes suivies sous 3 000 abonnés ET médiane < 1 000 vues → `status='inactive'` ; candidates venues de `trending`/`comment_author` → `ignored` ; sujets `proposed` sans vidéo qualifiée → `rejected`. Ne supprime rien sans ma validation du dry-run.
8. **Import** : importe `seed/channels_vidiq.csv` (465 chaînes vérifiées) et les 3 nouvelles niches de `seed/niches.csv` (niches d'exploration sans chaîne liée : pas de note de faisabilité).
9. **Contrôle** : relance `node --env-file=.env.local scripts/diagnose-data.mjs` avant et après, et montre-moi les deux `design/diagnostic.md` côte à côte.

Critère de fin : pour chaque niche principale, ≥ 300 chaînes de qualité suivies, ≥ 2 000 vidéos longues sur 90 jours, ≥ 20 sujets validés ayant chacun ≥ 5 vidéos qualifiées et ≥ 200 commentaires analysés.

---

## P37-bis — Finir le pipeline de données (sujets, rattachement, commentaires)

> Contexte : diagnostic du 2 oct. 2026 (19:05) après P37. La collecte de vidéos marche (3 968 vidéos < 90 j, 0 chaîne jamais vérifiée), mais tout ce qui vient après est resté figé : 13 vidéos rattachées à un sujet, 0 nouveau sujet, 0 sujet validé, 5 310 commentaires (inchangé), 3 840 commentaires jamais classés, 1 seul sujet scoré, aucun job enregistré depuis le 28 sept., dépôt git sans aucun commit.

Lis `design/diagnostic.md`, AI_RULES.md et ARCHITECTURE.md, puis :

1. **Git** : le dépôt n'a aucun commit. Vérifie `.gitignore` (`.env.local` exclu), puis fais un premier commit. Si git renvoie « Resource deadlock avoided », c'est que le dossier Desktop est synchronisé iCloud : dis-le-moi au lieu de contourner.
2. **Traçabilité** : chaque étape (collect, discover, embed, link, comments, classify, score) écrit une ligne dans `jobs` avec quota et items, même lancée à la main. `pnpm nightly` enchaîne toutes les étapes dans cet ordre et s'arrête proprement à `YT_QUOTA_SOFT_LIMIT`.
3. **Embeddings** : calcule l'embedding de toutes les vidéos < 90 j qui n'en ont pas (titre + début de description, Voyage `input_type=document`). Affiche le coût estimé et attends ma confirmation avant de lancer (règle 24).
4. **Découverte de sujets** : lance la proposition de sujets à partir des outliers (vues ≥ 3× la médiane de la chaîne) et des commentaires de frustration, par niche, avec nommage Haiku. Objectif : ≥ 30 sujets `proposed` par niche, y compris Business, History et Health. Montre le coût Haiku avant de lancer.
5. **Rattachement** : rattache chaque vidéo < 90 j au sujet le plus proche si similarité ≥ 0,75, sinon laisse `topic_id` vide. Affiche la répartition par niche.
6. **Les 78 sujets écrits à la main** : après rattachement, ceux qui ont 0 vidéo passent en `rejected` et leurs requêtes restent dans `topic_queries` comme graines de recherche. Mode `--dry-run` d'abord, j'approuve la liste.
7. **Commentaires** : pour les vidéos longues (≥ 8 min, ≥ 10 k vues, < 60 j) rattachées à un sujet, récupère 100 commentaires `order=relevance` (1 unité par appel), viser ≥ 200 commentaires par sujet. Puis classe **tous** les commentaires non classés via la Batch API Haiku (coût affiché avant).
8. **Score** : recalcule le score de **tous** les sujets non rejetés, MGI borné 0–100, confiance `low` si < 5 vidéos ou < 200 commentaires.
9. **Business & Case Studies** : 78 chaînes mais seulement 45 vidéos sur 90 j. Liste les chaînes de cette niche sans vidéo depuis 90 j et propose de les passer en `inactive`.
10. Relance `node --env-file=.env.local scripts/diagnose-data.mjs` et résume-moi : vidéos rattachées par niche, sujets par statut, commentaires classés, sujets avec confiance `medium` ou `high`.

Critère de sortie : ≥ 60 % des vidéos longues < 90 j rattachées ; ≥ 20 sujets par niche principale avec ≥ 5 vidéos ; ≥ 90 % des commentaires classés ; tous les sujets actifs scorés le même jour.

## P37-ter — Rendre le score utile (demande, frustration, sujets propres)

> Diagnostic du 3 oct. 2026 (01:43) après P37-bis. Rattachement OK (2 859 vidéos, 217 sujets actifs) et commentaires tous classés. Mais le score ne sert à rien : **Demande = 0 pour tous les nouveaux sujets**, donc MGI = 0 partout. Les seuls MGI à 100 sont des sujets avec 0 ou presque 0 vidéo (« real estate vs stocks », « Could AI Destroy Humanity? »). La frustration est ≈ 0, car aucun commentaire n'a été collecté pour les nouveaux sujets (5 310, inchangé). Tous les sujets sont en phase 1. Beaucoup de sujets n'ont que 2 ou 3 vidéos ou sont du bruit (« LIVE AMA | Summer of CCNA | 07/09/2026 »). Business & Case Studies a 0 sujet. Un job `collect` est resté NON TERMINÉ (03/10 01:45), et deux jobs `embed` ont échoué sur des timeouts.

Lis `design/diagnostic.md`, puis `lib/scoring/*` et la formule MGI dans ARCHITECTURE.md, puis :

1. **Verrou de job** : nettoie le job `collect` NON TERMINÉ (marquer `error='abandoned'` si démarré il y a plus de 2 h) et ajoute cette règle au verrou atomique, pour qu'un job planté ne bloque plus les suivants. Les embeddings passent par lots de 64 avec 3 tentatives et un backoff ; un lot qui échoue ne coupe pas le job.
2. **Demande calculée depuis YouTube**, sans dépendre de Google Trends. Pour chaque sujet, sur les vidéos rattachées des 90 derniers jours :
   - (a) **vélocité** = vues/jour médianes des vidéos < 30 j ;
   - (b) **ratio outlier** = médiane de (vues / médiane des vues de la chaîne) ;
   - (c) **nombre de vidéos outliers** (ratio ≥ 3).

   Normalise chaque composante en percentile **à l'intérieur de la niche**, puis D = 0,4·a + 0,4·b + 0,2·c, sur 0–1. Google Trends (SerpApi) devient un simple bonus : uniquement les 5 meilleurs sujets par niche, une fois par semaine (≈ 130 requêtes/mois, sous le quota de 250).
3. **Offre O_q** : nombre de vidéos longues de qualité (≥ 8 min, chaîne ≥ 10 k abonnés) publiées sur 90 j, divisé par la médiane de la niche.
4. **Garde-fous du MGI** : MGI = null et confiance `insufficient` si le sujet a moins de 5 vidéos rattachées. Un sujet sans score n'apparaît jamais dans un top. Le MGI final est le percentile du score brut dans la niche (0–100), pour comparer facilement les sujets entre eux.
5. **Phase** : calcule la phase à partir de la pente des uploads sur les sujets (4 semaines contre les 8 précédentes) et de l'âge médian des outliers. Montre-moi la répartition des phases par niche ; si plus de 80 % des sujets sont dans la même phase, c'est un bug à corriger.
6. **Nettoyage des sujets** :
   - fusionne les sujets dont les centroïdes ont une similarité ≥ 0,85 ;
   - passe en `proposed` (et non `active`) tous les sujets créés automatiquement, sauf `in_production` ;
   - rejette les sujets de moins de 5 vidéos et ceux dont le libellé contient une date, « LIVE », « AMA », « Q&A » ou « stream ».

   Utilise `--dry-run` d'abord, puis montre-moi la liste par niche et attends ma validation.
7. **Commentaires des nouveaux sujets** : pour chaque sujet restant, prends les 3 vidéos longues les plus vues et récupère 100 commentaires `order=relevance` par vidéo (≈ 1 unité par appel). Classe les nouveaux commentaires avec la Batch API Haiku et affiche le coût avant. Frustration = part pondérée par les likes des labels ≠ `none`.
8. **Business & Case Studies** (0 sujet, 45 vidéos) : liste les chaînes de cette niche avec leur nombre de vidéos sur 90 j. Si plus de 50 % n'ont rien publié, propose-moi de les passer en `inactive`. Je compléterai la niche avec P36 ou vidIQ.
9. Recalcule tous les scores, relance `node --env-file=.env.local scripts/diagnose-data.mjs`, puis commit.

Critère de sortie :
- Demande > 0 pour au moins 90 % des sujets scorés.
- MGI réparti sur toute l'échelle 0–100 dans chaque niche.
- Aucun sujet de moins de 5 vidéos dans les tops.
- Au moins 3 phases représentées dans chaque niche principale.
- ≥ 200 commentaires classés pour les 10 meilleurs sujets de chaque niche.

## P37-quater — Derniers trous du pipeline (court)

> Diagnostic du 3 oct. 2026 (07:22). Le score fonctionne pour Finance, Psych et IA. Il reste 5 trous.

1. **Nouvelles vidéos non rattachées.** Le job `collect` de 01:45 a ajouté environ 2 400 éléments, mais `embed` a traité 0 vidéo à 02:00. Les vidéos rattachées sont restées à 2 859 alors qu'il y a 4 816 vidéos < 90 j. Trouve pourquoi `runClustering` ne sélectionne pas les vidéos sans embedding (filtre de date, `is_qualified`, ou niche ?). Corrige, puis rattrape toutes les vidéos < 90 j sans embedding et rattache-les (seuil 0,75). Affiche le coût Voyage avant.
2. **History et Health non scorés.** Des sujets avec 8 à 18 vidéos sont marqués `insufficient` (ex. « personalized nutrition », 18 vidéos). Vérifie que le seuil de 5 vidéos compte bien les vidéos rattachées sur 90 j, et que le score tourne pour **toutes** les niches.
3. **Garde-fou < 5 vidéos incohérent.** « Carl Jung - How Life Changes After 40 » a 2 vidéos et un MGI de 67 en Finance. Ce sujet est en plus dans la mauvaise niche. Applique le garde-fou partout (MGI null si < 5) et rejette les sujets restants issus des anciennes requêtes manuelles, dont le libellé est un titre de vidéo.
4. **Business & Case Studies : 0 sujet** malgré 64 vidéos longues. Lance la proposition de sujets pour cette niche et dis-moi pourquoi elle avait été sautée.
5. **Ordre du nightly** : chaque étape doit voir les données écrites par la précédente. Ajoute un test qui le vérifie.

Relance ensuite le diagnostic et fais un commit.

Critère de sortie :
- ≥ 85 % des vidéos longues < 90 j rattachées.
- Les 6 niches ont au moins 10 sujets scorés.
- Aucun sujet de moins de 5 vidéos avec un MGI.

## P39 — Faire grossir les sujets émergents (« À surveiller » vides)

Contexte : sur la Carte (dashboard), 60 des 61 sujets « À surveiller » n'ont que 2 ou 3 vidéos. Le score les classe en confiance `insufficient` (mgi null, demand 0, supply_q 0) et ils restent bloqués là : rien ne leur rattache de nouvelles vidéos et rien ne les ferme. Lis d'abord `design/AUDIT_PIPELINE_2026-10-03.md` (points 6 et suivants) et `lib/topics/attach-service.ts`, `scripts/attach-videos.ts`, `scripts/reject-empty-topics.ts`, `lib/scoring/score-service.ts`.

Objectif : un sujet « insuffisant » doit, en 2 à 3 nuits, soit atteindre 5 vidéos et être mesuré, soit être fermé. Plus aucun sujet ne doit rester plus de 21 jours à moins de 5 vidéos.

1. Rattachement ciblé (gratuit en quota) : chaque nuit, après la collecte, pour chaque sujet `active` dont le dernier score est `insufficient`, compare son centroïde d'embeddings aux vidéos des 30 derniers jours de la même niche qui n'ont pas de sujet (`topic_id is null`). Rattache au-dessus du seuil de rattachement (0,72, cf. audit), au maximum 40 vidéos par sujet et par nuit. Journalise le nombre rattaché par sujet dans le job.
2. Recherche YouTube ciblée (payante en quota, plafonnée) : pour les sujets encore sous 5 vidéos après l'étape 1 ET créés depuis plus de 3 jours, lance une recherche via `lib/youtube/search.ts` (seul fichier autorisé à appeler search.list, 100 unités l'appel) avec le libellé du sujet, `publishedAfter` = 90 jours, `type=video`, `videoDuration=medium|long`. Plafond : 15 recherches par nuit (1 500 unités), priorité aux sujets dont les 2–3 vidéos ont le plus de vues. Les vidéos trouvées passent par le même contrôle de similarité que l'étape 1 avant d'être rattachées (pas de rattachement aveugle). Ajoute la variable `EMERGING_SEARCHES_PER_NIGHT` (défaut 15, 0 = désactivé) et respecte le budget de temps par étape déjà en place.
3. Fermeture : un sujet toujours sous 5 vidéos 21 jours après sa création passe `status = 'rejected'` avec la raison « trop peu de vidéos après 21 jours » (réutilise `reject-empty-topics`). Ne ferme jamais un sujet qui a au moins une vidéo dans « Mes vidéos » d'un client (`angles.user_id is not null`).
4. Score : pas de changement de formule. Vérifie seulement que les sujets `insufficient` gardent `mgi = null` (l'interface les affiche « Pas encore mesuré · N vidéos repérées »).
5. Rapport : le job `nightly` écrit dans `items_processed`/`error` un résumé « sujets enrichis X, vidéos rattachées Y, recherches Z (quota Q), sujets fermés W ».

Règles : ne lance pas `pnpm nightly` ni le workflow à la main pendant qu'un autre run tourne ; script de fermeture testé d'abord en `--dry-run` et résultat montré avant exécution ; `pnpm build` doit passer avant tout push ; demande-moi confirmation avant toute action qui consomme de l'IA payante.

Test d'acceptation : après une nuit, la page Carte filtrée sur « À surveiller » montre au moins 30 % de sujets placés sur le graphique (mesurés), et le résumé du job indique le quota YouTube consommé par l'étape.

## P40 — Faisabilité calculée pour chaque client (fini le « C » partout)

Contexte : `computeFeasibility` (lib/scoring/feasibility.ts) compare la taille de la chaîne du propriétaire aux chaînes concurrentes. Elle lit encore `niches.owner_channel` (score-service.ts, ~l. 389 et 493). Avec l'espace client (migration 00018), chaque client a ses chaînes dans `user_channels` et deux clients d'une même niche n'ont pas la même taille : une note unique écrite dans `topic_scores` ne peut pas être juste. Résultat aujourd'hui : « C — Aucune chaîne propriétaire configurée » sur tous les sujets (l'interface masque cette note en attendant).

1. Migration `00020_faisabilite_par_client.sql` :
   - `topic_scores.competitor_subs int[]` : abonnés des chaînes concurrentes retenues (vidéos ≥ 8 min, 90 derniers jours, chaînes ≥ 10 k), triés, 200 valeurs au plus.
   - `user_channels.subscriber_count int` et `user_channels.subscribers_checked_at timestamptz`.
2. Score (score-service.ts) : écris `competitor_subs` à chaque calcul. Garde `feasibility_grade/reason` uniquement pour l'administrateur (calcul avec `niches.owner_channel` comme aujourd'hui) le temps de la transition.
3. Abonnés des chaînes clients : nouvelle étape de nuit (après la collecte) qui lit les `user_channels` ayant un `youtube_channel_id` commençant par `UC` et met à jour `subscriber_count` via `channels.list` (lots de 50, 1 unité par lot). Pour un `@pseudo`, résous-le une seule fois avec `channels.list?forHandle=` et remplace la valeur par l'identifiant `UC…`.
4. Calcul à l'affichage : ajoute `lib/scoring/feasibility-for-user.ts` qui, pour un client, une niche et un sujet, appelle `computeFeasibility(subsDeSaChaîneDansCetteNiche, competitor_subs, competitor_subs.length)`. Utilise-le dans `app/(app)/dashboard/page.tsx` (colonne Faisabilité et fiche à droite), `app/(app)/sujets` (panneau du sujet, ligne « Faisabilité ») et `app/(app)/topics/[id]`. Sans chaîne YouTube renseignée ou sans `subscriber_count`, n'affiche pas de note : affiche « Ajoute l'adresse YouTube de ta chaîne dans Réglages pour voir tes chances » avec un lien vers `/settings#chaines`.
5. Textes : garde les raisons en français tutoyé (déjà le cas dans feasibility.ts) ; remplace « vidéos qualifiées » par « bonnes vidéos » dans les raisons.

Règles : migration montrée avant exécution (je la lance moi-même dans Supabase) ; `pnpm build` doit passer ; pas de push pendant un run de nuit.

Test d'acceptation : avec un compte client dont la chaîne a 3 000 abonnés et un autre à 300 000 sur la même niche, un même sujet affiche deux notes différentes, chacune avec sa raison.

## P38 — Déployer : l'app sur Vercel, le pipeline de nuit sur GitHub Actions

> La phase données est validée (diagnostic du 3 oct. 15:19). Jusqu'ici tout tourne à la main depuis le Mac. Objectif : que la collecte, le classement et le score tournent seuls chaque nuit, même Mac éteint.

1. **Pipeline de nuit = GitHub Actions** (pas les crons Vercel, dont la durée par fonction est limitée). Vérifie d'abord dans la doc à jour les limites du plan Vercel Hobby et de GitHub Actions, puis crée un dépôt GitHub **privé** et pousse le code (vérifie avant que `.env.local` n'est pas suivi). Ajoute `.github/workflows/nightly.yml` :
   - déclenché par `schedule` à 02:00 UTC et par `workflow_dispatch` ;
   - lance `pnpm install --frozen-lockfile` puis `pnpm nightly` ;
   - timeout de 60 min ;
   - lit les clés depuis les **GitHub Secrets**. Donne-moi la liste exacte des noms de secrets à créer : je les colle moi-même dans GitHub, jamais dans le chat.
2. **App = Vercel** : `vercel link` puis variables d'environnement Production, en me listant les noms. Je colle les valeurs dans le tableau de bord Vercel. Retire de `vercel.json` les crons remplacés par GitHub Actions, garde le digest du dimanche s'il est court.
3. **Supabase Auth** : ajoute l'URL Vercel dans Site URL et Redirect URLs.
4. **MCP et extension** : mets à jour l'URL de base (`/api/mcp`) et l'origine autorisée de l'extension vers le domaine Vercel.
5. **Alerte d'échec** : si `pnpm nightly` échoue ou utilise 0 quota deux nuits de suite, envoie un e-mail Resend à mon adresse.
6. Lance le workflow une fois à la main (`workflow_dispatch`), montre-moi le log, ouvre l'app en production et vérifie la connexion, l'accueil et une fiche sujet. Commit.

Critère de sortie :
- Le lendemain à 03:00 UTC, le diagnostic montre de nouveaux jobs `collect`, `embed`, `classify` et `score` datés de la nuit, lancés sans moi.
- L'app répond en production.

## P36-bis — Corriger la découverte et le budget de temps du pipeline de nuit

> Diagnostic du 3 oct. 2026 (19:41), après le premier run GitHub Actions, qui a réussi en 55 min.

**Ce qui marche :**
- La collecte a apporté 13 777 éléments pour 509 unités de quota.
- Il y a 7 626 vidéos de moins de 90 j, et Business compte maintenant 629 vidéos longues.
- History et Health sont scorés.

**Ce qui ne marche pas :**

1. **La collecte a mangé tout le temps.** `collect` a duré environ 50 min (18:35 → 19:25), puis toutes les étapes suivantes ont tourné en 5 min avec **0 élément** : embed, attach, discover-topics, quality-gates, discover-channels, auto-triage et classify. Résultat :
   - environ 3 450 nouvelles vidéos ne sont pas rattachées (toujours 4 173 rattachées) ;
   - environ 3 400 nouveaux commentaires ne sont pas classés (24 274 commentaires pour 20 854 labels) ;
   - Business n'a toujours aucun sujet scorable.
2. **La découverte ramène du bruit.** Les 99 candidates viennent toutes de la source `trending` (mostPopular), que P37 avait demandé de supprimer : Mrwhosetheboss, des chaînes gaming, Zack D. Films… Elles n'ont ni abonnés, ni médiane, ni niche, et l'auto-triage n'a rien évalué.

Lis `design/diagnostic.md`, `scripts/nightly.ts`, `lib/youtube/discover-*.ts` et `lib/youtube/auto-triage.ts`, puis :

1. **Budget de temps par étape** dans `nightly.ts` :
   - collect : 40 % du temps au maximum ;
   - embed + attach : 15 % ;
   - discover (topics + channels + triage) : 15 % ;
   - classify : 15 % ;
   - score : le reste.

   Une étape qui atteint son budget s'arrête proprement et reprend la nuit suivante, sans être marquée NON TERMINÉ. L'ordre ne change pas, mais **score tourne toujours**. Passe aussi le workflow à `timeout-minutes: 120` et `NIGHTLY_DEADLINE_MIN: 100`.
2. **Collect plus léger** :
   - RSS d'abord pour les 541 chaînes ;
   - `videos.list` par lots de 50, uniquement pour les nouvelles vidéos et pour les snapshots dus selon les paliers (J+1, J+3, J+7, J+30) ;
   - mesure et affiche la durée de chaque sous-étape dans le log.
3. **Découverte** :
   - Supprime la source `trending`/mostPopular et rejette les 99 candidates actuelles (`--dry-run` d'abord).
   - Garde uniquement des sources liées aux niches : (a) search.list `order=relevance`, `videoDuration=medium|long` sur les requêtes des 10 meilleurs sujets de chaque niche ; (b) chaînes présentes dans les résultats de ces recherches ; (c) les « featured channels » des chaînes suivies.
   - Chaque candidate doit avoir une `niche_id` dès sa création.
4. **Auto-triage réel** : pour chaque candidate, appelle `channels.list` (lots de 50) et `playlistItems` sur ses 10 dernières vidéos, puis applique les seuils de P37 (≥ 4 vidéos longues sur 90 j, ≥ 10 k abonnés ou médiane ≥ 5 k vues, similarité ≥ 0,80 avec la niche). Les chaînes acceptées passent dans `channels`. Objectif : **+50 chaînes par niche et par semaine**, en commençant par Business, Psych et History.
5. **Rattrapage maintenant, en local** : lance embed → attach → discover-topics → quality-gates → classify → score sur les données existantes. Affiche le coût Voyage et Haiku avant de lancer.
6. Relance le diagnostic, puis commit et push.

**Critère de sortie :**
- ≥ 85 % des vidéos longues < 90 j rattachées.
- Business a ≥ 10 sujets scorés.
- 0 candidate venant de `trending`.
- Les candidates ont une niche et des abonnés.
- Le prochain run de nuit montre des items > 0 pour chaque étape.

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

## P36 — Moteur de découverte : passer de 100 à 5 000 chaînes

Objectif : 1 500 chaînes pertinentes par niche (≈ 5 000 au total) en 6 à 8 semaines, sans dépasser le quota gratuit de 10 000 unités/jour.

1. **Détection des nouvelles vidéos sans quota** : pour chaque chaîne suivie, lis le flux RSS public `https://www.youtube.com/feeds/videos.xml?channel_id=ID` (15 dernières vidéos, 0 unité). N'appelle `playlistItems.list` qu'en secours si le flux échoue. Les métriques (vues, likes, durée) restent récupérées par `videos.list` par lots de 50 (1 unité / 50 vidéos) et les chaînes par `channels.list` par lots de 50.
2. **Snapshots échelonnés** : quotidien pour les vidéos de moins de 14 jours, hebdomadaire de 14 à 90 jours, puis mensuel. Agrège les anciens snapshots dans `video_stats_weekly` pour contenir la taille de la base.
3. **Cinq sources de découverte**, toutes vers la file `candidate_channels` de P32 :
   - `search.list` : jusqu'à 60 recherches/jour sur les requêtes des sujets (tri par date et par pertinence, `type=video`, `publishedAfter` 90 j) ; chaque page renvoie jusqu'à 50 vidéos donc de nouvelles chaînes ;
   - chaînes mises en avant : `channelSections.list` (1 unité) sur chaque chaîne suivie, pour récupérer les chaînes qu'elle recommande ;
   - tendances : `videos.list?chart=mostPopular` par catégorie pertinente (Éducation, Science & Tech, Actualités, Divertissement) et par pays (US, GB, CA, AU), 1 unité par page ;
   - auteurs de commentaires qui sont eux-mêmes des chaînes actives de la niche (échantillon, sans stocker de données personnelles au-delà de l'ID de chaîne) ;
   - import manuel (CSV, URL, @handle) et bouton « Ajouter aux candidates » de l'extension.
4. **Tri automatique des candidates** : une chaîne est acceptée automatiquement si elle a ≥ 5 vidéos longues sur 90 jours, une médiane ≥ 2 000 vues et une similarité d'embedding ≥ 0,80 avec sa niche ; rejetée automatiquement sous des seuils bas ; le reste passe en validation manuelle. Probabilité faceless estimée par Claude Haiku (P32).
5. **Budget de quota piloté** : table `quota_plan` avec une enveloppe par tâche (suivi ≈ 3 500, découverte ≈ 3 000, commentaires ≈ 2 000, réserve ≈ 1 500) ; chaque job s'arrête à son enveloppe ; page Admin → Quota avec la consommation par tâche sur 30 jours.
6. **Tableau de bord de couverture** : par niche, nombre de chaînes suivies, candidates en attente, vidéos indexées sur 90 jours, et un indicateur « couverture suffisante » (≥ 1 000 chaînes et ≥ 20 000 vidéos sur 90 jours par niche). Tant que la couverture est insuffisante, le MGI affiche une confiance « Faible » (P29).
7. Prépare le texte de la demande d'extension de quota YouTube (formulaire d'audit), à envoyer une fois l'application en production.

---

## P28 — Contrôle qualité final

1. Audit sécurité complet (prompt P12 de la V1) étendu à : routes `/api/ext/*`, jetons API (hachage, révocation, portée lecture/écriture), CORS, permissions de l'extension.
2. Tests Playwright des 5 parcours de la phase 13 de PLAN_V2.md.
3. Lighthouse en production sur /today, /dashboard, /topics/[id] : Performance ≥ 90, Accessibilité ≥ 95.
4. Liste finale de ce qui reste imparfait, par ordre de gravité.
