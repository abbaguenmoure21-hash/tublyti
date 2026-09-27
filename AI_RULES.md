# AI_RULES.md — TubLyTI

Règles non négociables. Elles s'appliquent à chaque fonctionnalité, sans qu'on ait besoin de les répéter.

## Sécurité

1. Row Level Security activée sur chaque table au moment de sa création, avec une politique par `workspace_id`. Une table sans RLS ne passe pas en migration.
2. La clé YouTube, la clé Anthropic, la clé service role Supabase et tous les autres secrets ne sont jamais lus côté client, jamais écrits dans le code, jamais collés dans la conversation. `.env.local` en local, variables Vercel en production, `.env.example` sans valeurs dans le dépôt.
3. Toute route API vérifie l'authentification (session Supabase, `CRON_SECRET` ou `MCP_TOKEN`) avant de lire ou écrire quoi que ce soit.
4. Toute donnée entrante est validée par un schéma Zod côté serveur, même si l'interface la valide déjà.
5. Avant chaque déploiement en production, un audit de sécurité complet (prompt P12) est réalisé et ses conclusions traitées.

## Quota et budget

6. Interdiction d'appeler `search.list` ailleurs que dans `lib/youtube/search.ts`, qui plafonne à 100 appels par jour et journalise chaque appel.
7. Chaque appel YouTube passe par `YouTubeClient`, qui incrémente `jobs.quota_used` et lève `QuotaSoftLimitReached` à `YT_QUOTA_SOFT_LIMIT`. Les jobs attrapent cette exception et terminent proprement.
8. Chaque appel Claude passe par `LLMClassifier` ou `AngleGenerator`, qui estiment le coût, l'ajoutent au compteur mensuel et refusent au-delà de `AI_BUDGET_USD`. La classification utilise toujours la Batch API.
9. Un cron ne dépasse jamais 5 minutes d'exécution (limite Vercel) : il traite par lots, enregistre sa progression et reprend la nuit suivante.

## Fiabilité

10. Chaque cron écrit une ligne `jobs` au démarrage et la clôt à la fin (`finished_at`, `error`). Un cron qui plante sans ligne close déclenche l'alerte « collecte silencieuse ».
11. Les jobs sont idempotents : relancer un job de la même nuit ne duplique aucune donnée (clés primaires composites, `upsert`).
12. Un verrou (`settings.lock_<kind>`) empêche deux exécutions simultanées du même job.

## Qualité du code

13. TypeScript strict, aucun `any` sans commentaire `// why:`.
14. La logique de scoring (`lib/scoring/*`) est pure (entrées → sorties, sans accès base) et couverte par des tests Vitest avec des cas limites (signal manquant, division par zéro, sujet sans commentaire).
15. Chaque fournisseur externe a une implémentation `Fake*` utilisée par les tests et par le mode `DEMO=true`.
16. Chaque page qui affiche des données gère trois états : chargement, vide (message d'accueil utile), erreur (message en langue de l'utilisateur, sans stack trace).
17. Les prompts envoyés à Claude vivent dans `lib/nlp/prompts/` en fichiers versionnés, jamais en chaîne inline ; chaque changement de prompt incrémente `PROMPT_VERSION`, stocké dans `comment_labels.model`.

## Comportement de l'agent

18. Proposer un plan et attendre validation avant d'écrire du code pour une nouvelle phase.
19. Demander confirmation avant toute migration destructrice (suppression de colonne, de table, de données) et avant toute modification de `vercel.json` ou des politiques RLS.
20. Signaler immédiatement toute limitation d'API découverte en cours de route (quota, endpoint déprécié, changement de tarif) plutôt que de la contourner silencieusement.
21. Ne jamais scraper YouTube, Reddit ou TikTok en dehors de leurs API officielles.
22. Répondre en français ; code et identifiants en anglais.
