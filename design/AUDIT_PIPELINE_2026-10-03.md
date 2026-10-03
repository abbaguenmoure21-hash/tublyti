# Audit du pipeline — 3 oct. 2026

> Lecture du code (HEAD f317d0a + fichiers en cours de modification par la session P36-bis : collect.ts, discover-sources.ts, nightly.ts) et du diagnostic de 19:41. Chaque point indique sa preuve.

## Bloquants

1. **L'auto-triage n'évalue jamais les nouvelles candidates.**
   - Preuve : `lib/youtube/auto-triage.ts`, la requête filtre `.not('subscriber_count','is',null)`.
   - Rien n'enrichit les candidates : pas de `channels.list`, pas de `playlistItems`.
   - Conséquence : les 99 candidates ont `subscriber_count = null`, donc 0 traitée (job `auto-triage · items 0`).
2. **Une chaîne acceptée n'est jamais ajoutée aux chaînes suivies.**
   - Preuve : `updateDecision()` met seulement `status = 'accepted'` dans `candidate_channels`, sans aucun insert dans `channels`.
   - Conséquence : même quand la découverte marche, la base reste à 541 chaînes.
3. **La similarité de niche est calculée sur le mauvais texte.**
   - Preuve : `embedder.embed([candidate.title])` compare le **nom de la chaîne** (« Mrwhosetheboss ») au **nom de la niche** (« AI Tools & Automation »).
   - Le commentaire en tête du fichier annonce pourtant « 10 last titles vs niche centroid ».
   - Conséquence : le score n'a aucun sens, donc les décisions d'accepter ou de rejeter sont aléatoires.
4. **Le build sera cassé tant que la session P36-bis n'aura pas fini.**
   - Preuve : `scripts/nightly.ts` (copie de travail) lit `triage.enriched`, `triage.promoted` et `triage.quotaUsed`, absents de `TriageResult`.
   - `tsconfig` inclut `scripts/`, donc `pnpm build` échouera si ce fichier part tel quel.

## Importants

5. **99 candidates `trending` encore en attente.**
   - Le code `trending` a disparu de la copie de travail, mais les lignes sont restées en base.
   - À faire : `scripts/cleanup-data.ts` (section candidates) en `--dry-run`, puis exécution.
6. **Seuil de rattachement abaissé à 0,66.**
   - Preuve : `lib/topics/attach-service.ts`, `SAME_NICHE_THRESHOLD = 0.66`, alors que P37 demandait 0,75.
   - Conséquence : plus de vidéos rattachées, mais des sujets fourre-tout (« wealth building mindset habits », 218 vidéos).
   - Recommandation : 0,72 et un plafond de 150 vidéos par sujet ; au-delà, on re-découpe le sujet.
7. **Le MGI en percentile est trompeur dans les petites niches.**
   - Avec 7 sujets scorés (History), les valeurs possibles sont seulement 100, 86, 71… Un sujet de 7 vidéos en confiance « medium » sort à 100.
   - Recommandation : calculer le percentile sur **toutes les niches** quand une niche a moins de 20 sujets scorés, et toujours afficher la confiance à côté du MGI.
8. **On embedde des vidéos inutiles.**
   - Preuve : `runEmbedAll` traite toutes les vidéos sans embedding, y compris les Shorts et celles de plus de 90 j.
   - Recommandation : filtrer `published_at >= now() - 120 j` et `duration_s >= 61` pour économiser du temps et du Voyage.
9. **Un seul titre en erreur bloque tout l'embedding.**
   - Preuve : si `embedder.embed` lève une exception, la boucle `runEmbedAll` s'arrête et les vidéos suivantes ne sont jamais traitées.
   - Recommandation : try/catch par lot, avec marquage `embedding_failed_at`.

## Déjà corrigé (vérifié)

- Budget de temps par groupe d'étapes dans `nightly.ts` (40/15/15/15/reste) et workflow à 120 min / 100 min.
- Les étapes sautées sont enregistrées proprement (`skipped: deadline reached`).

## Prompt à donner à la session P36-bis (ou à la suivante)

```
Corrige les points 1 à 4 et 6 à 9 de design/AUDIT_PIPELINE_2026-10-03.md :
1. auto-triage : enrichis les candidates sans subscriber_count via channels.list (lots de 50) puis playlistItems (10 dernières vidéos : durée, vues), calcule long_video_count et median_views.
2. Une chaîne acceptée est insérée dans channels (même niche_id, uploads_playlist_id), puis la candidate passe en 'promoted'.
3. Similarité = moyenne des embeddings des 10 derniers titres, comparée au centroïde des vidéos rattachées de la niche (pas au nom de la niche).
4. TriageResult expose enriched, promoted, quotaUsed ; pnpm build doit passer.
5. Exécute cleanup-data pour les candidates trending (dry-run d'abord).
6. Seuil d'attache 0,72 et plafond de 150 vidéos par sujet (sinon re-découpage).
7. Percentile MGI sur toutes les niches si la niche a moins de 20 sujets scorés.
8-9. runEmbedAll : uniquement les vidéos < 120 j et ≥ 61 s, try/catch par lot.
Lance pnpm build, relance le diagnostic, commit et push.
```
