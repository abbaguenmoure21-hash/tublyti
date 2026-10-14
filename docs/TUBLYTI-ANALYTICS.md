# Contrat TubLyTI Analytics (serveur MCP)

Adresse : `https://tublyti.vercel.app/api/mcp` · authentification : jeton TubLyTI (Réglages › Connexion à Claude), en-tête `Authorization: Bearer <jeton>`.
Lecture seule. Le jeton ne voit que les chaînes **vérifiées** de son propriétaire. Les quatre outils répondent en **JSON** (texte JSON dans le contenu MCP).

## 1. `list_my_channels` — aucun paramètre
```json
{ "channels": [ { "channel_id": "UC…", "name": "…", "handle": "@…", "subscribers": 1234, "niche": "…", "analytics_connected": true } ] }
```

Liste vide : la réponse ajoute `reason` et `help` :
- `token_without_account` : jeton créé avant les comptes personnels, rattaché à aucun compte → créer un nouveau jeton dans Réglages › Connexion à Claude, connecté avec le compte qui possède les chaînes ;
- `no_verified_channel` : le compte a des chaînes, aucune vérifiée → Réglages › Mes chaînes › Vérifier ;
- `no_channel` : le compte du jeton n'a aucune chaîne (jeton créé depuis un autre compte).

## 2. `list_my_videos` — `channel?` (nom, @pseudo ou UC…), `limit?` (défaut 20, max 50)
```json
{ "channel_id": "UC…", "videos": [ { "video_id": "…", "title": "…", "published_at": "ISO", "duration_s": 540, "format": "long|short", "views": 1200, "likes": 40, "comments": 3, "url": "https://youtube.com/watch?v=…" } ] }
```
Une vidéo apparaît après la collecte de nuit qui suit sa publication.

## 3. `get_video_performance` — `video` (lien ou ID)
```json
{
  "video_id": "…", "title": "…", "published_at": "ISO", "duration_s": 540, "analytics_connected": true,
  "public": { "views": 1200, "likes": 40, "comments": 3, "as_of": "ISO" },
  "analytics": { "views": 1180, "watch_time_minutes": 3400, "avg_view_duration_s": 172, "avg_view_percentage": 31.8, "subscribers_gained": 4, "likes": 40, "comments": 3, "shares": 2 },
  "retention": {
    "points": [ { "t_ratio": 0.01, "t_seconds": 5, "watch_ratio": 0.92 } ],
    "relative_to_similar_videos": 0.47,
    "biggest_drop": { "t_ratio": 0.12, "t_seconds": 65, "size": 0.08 }
  },
  "thumbnail": {
    "impressions": 15400, "ctr": 0.0462,
    "first_day": "2026-09-14", "last_day": "2026-10-13",
    "daily": [ { "day": "2026-10-13", "impressions": 820, "ctr": 0.051 } ]
  }
}
```
- `analytics` vaut `null` si YouTube Analytics n'est pas connecté.
- `retention` vaut `{ "unavailable": "analytics_not_connected" | "vide" | "acces-retire" | "autre" }` quand la courbe manque (« vide » : pas assez de vues).
- `watch_ratio` peut dépasser 1 (relectures). `relative_to_similar_videos` : 0,5 = moyenne des vidéos YouTube de même durée.
- **La phrase exacte où les spectateurs partent** : TubLyTI donne l'instant (`biggest_drop.t_seconds`) ; c'est l'outil qui possède le script ou la transcription qui fait la correspondance instant → phrase.
- **CTR et impressions** (YouTube Reporting API, rapport `channel_reach_basic_a1`) : `ctr` est une **fraction** (0,0462 = 4,62 %), pondérée par les impressions sur toute la période disponible ; `impressions` est le total. Les fichiers arrivent une fois par jour (≈ 1 à 2 jours de retard) ; à la connexion, YouTube rattrape les 30 jours précédents.
- Quand le CTR manque : `"thumbnail": { "impressions": null, "ctr": null, "unavailable": "analytics_not_connected" | "report_job_pending" | "no_data_yet" | "report_error" }`. `no_data_yet` : premier fichier attendu sous 48 h après la connexion.

## 4. `get_video_retention` — `video`, `channel?`
Résumé en texte de la courbe (pour une lecture humaine). Pour un programme, préférer `get_video_performance.retention`.

Autres outils utiles : `get_my_channel_stats` (statistiques de la chaîne, texte), `list_today`, `get_topic_gap`, `list_frustrations`…

## Jeton ancien sans propriétaire (list_my_channels vide)

Cause constatée : un jeton créé avant la migration 00019 a `api_tokens.user_id = null`.
Le backfill de 00019 ne rattachait le jeton que si un profil avait `role = 'admin'` ;
quand l'admin vient de `ADMIN_EMAILS`, le jeton restait orphelin, donc aucune chaîne.

Correctif (`lib/mcp/auth.ts`) : au premier appel, le jeton orphelin est rattaché
automatiquement à son propriétaire (profil admin unique, sinon adresse `ADMIN_EMAILS`,
sinon le seul compte qui a une chaîne vérifiée), puis `user_id` est enregistré.
Le jeton garde ses droits d'administrateur. Un admin via `ADMIN_EMAILS` est aussi
reconnu pour les jetons rattachés.

Solution immédiate sans déploiement : créer un nouveau jeton dans Réglages
(il est créé avec `user_id`) et le coller dans le Studio à la place de l'ancien.

## analyze_video — contenu d'une vidéo (image, audio, texte)

`analyze_video { video: "<lien ou ID>", force?: boolean }` → JSON :

- `video_id`, `url`, `title`, `channel_title`, `duration_s`, `analyzed_at`, `model`, `cached`, `with_retention`
- `analysis` :
  - `summary`, `topic`, `language`, `audience`
  - `format { style, visuals[], voice, voice_tone, music, on_screen_text, cuts_per_minute, pacing }`
  - `hook { start_s, end_s, said, shown, promise, technique }`
  - `chapters [{ start_s, end_s, title, summary }]`
  - `retention_devices [{ at_s, technique, description }]`
  - `cta [{ at_s, text }]`, `packaging { title_promise, delivered }`
  - `why_it_works[]`, `weaknesses[]`, `how_to_adapt[]`
  - `retention_notes [{ at_s, drop, what_happens, fix }]` — seulement pour une vidéo d'une de MES chaînes avec Analytics connecté
  - `transcript [{ at_s, text }]`, `transcript_partial`

Erreurs (isError, texte JSON `{ error, message }`) : `invalid`, `not_found`, `private` (privée/non répertoriée),
`live`, `too_long` (> 60 min), `budget`, `busy` (analyse en cours, réessayer dans 1 min), `disabled` (pas de clé Gemini), `gemini`.

Première analyse : 30 s à 2 min. Ensuite le résultat est en cache (instantané, sans coût). Limite : 15 appels / jour / jeton.
Voie technique : Gemini lit le lien YouTube public directement (aucun téléchargement de la vidéo).
