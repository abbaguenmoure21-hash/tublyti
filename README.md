# tublyti
Youtube engine research

## Accès et inscriptions

L'accès est sur invitation : `ALLOW_SIGNUP` reste `false` en production.
Cette variable ne suffit pas à fermer les inscriptions (la clé anonyme Supabase est publique) :
dans le tableau de bord Supabase, **Authentication → Sign In / Providers → « Allow new users to sign up »** doit être **désactivé**.
Vérification : un `supabase.auth.signUp()` direct en production doit échouer avec « Signups not allowed for this instance ».
Le lien de connexion par e-mail utilise `shouldCreateUser: false` et ne crée donc jamais de compte.

## Adresse publique du site

`NEXT_PUBLIC_APP_URL` (ex. `https://tublyti.com`, sans `/` final) est **requise en production** :
elle sert de `metadataBase`, donc à rendre absolues les URL de l'image de partage (`app/opengraph-image.png`,
`app/twitter-image.png`, aperçu fictif 1200×630), ainsi qu'à `robots.txt` et `sitemap.xml`.
