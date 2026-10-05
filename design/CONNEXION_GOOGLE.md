# Activer « Ajouter avec Google »

1. console.cloud.google.com › même projet que la clé YouTube › API et services › Écran de consentement OAuth :
   type « Externe », nom TubLyTI, e-mail d'assistance, logo facultatif, page d'accueil = adresse Vercel,
   règles de confidentialité = <adresse Vercel>/confidentialite, domaine autorisé = domaine Vercel.
2. Champs d'application (scopes) : ajouter `.../auth/youtube.readonly` (preuve de propriété),
   `.../auth/yt-analytics.readonly` et `.../auth/yt-analytics-monetary.readonly` (page « Ma chaîne »).
   Activer aussi « YouTube Analytics API » dans API et services › Bibliothèque.
3. Utilisateurs test : ajouter les adresses Gmail des personnes qui testeront (jusqu'à 100) tant que l'app est « En test ».
4. Identifiants › Créer › ID client OAuth › Application Web. URI de redirection autorisées :
   - http://localhost:3000/api/youtube/callback
   - https://<adresse Vercel>/api/youtube/callback
5. Copier l'ID client et le code secret dans `.env.local` et dans Vercel :
   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, NEXT_PUBLIC_APP_URL (l'adresse Vercel en production ; vide en local),
   NEXT_PUBLIC_CONTACT_EMAIL (adresse de contact affichée sur la page Confidentialité).
6. Pour ouvrir à tous : « Publier l'application » puis demander la validation Google (scope sensible) :
   domaine vérifié dans Google Search Console, page d'accueil et page Confidentialité en ligne, courte vidéo montrant l'usage
   (bouton « Avec Google » › choix du compte › chaîne ajoutée). Compter quelques jours à quelques semaines.
   En attendant, « Avec un lien » reste disponible pour tout le monde.

## Statistiques privées et revenus (page « Ma chaîne »)

- Bouton « Connecter YouTube Analytics » : `/api/youtube/connect?mode=analytics&chaine=<id>` (accès hors ligne,
  `prompt=consent`). Le retour vérifie que le compte Google gère bien cette chaîne, puis enregistre le jeton
  d'actualisation chiffré dans `user_channel_tokens` (migration 00023).
- Variable obligatoire : `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`), dans `.env.local` et Vercel. Ne jamais la changer.
- Les chiffres sont gardés 6 heures dans `channel_analytics`. Le bouton « Actualiser » force une nouvelle lecture.
- Les revenus n'apparaissent que pour une chaîne du Programme Partenaire et si la case revenus a été cochée.
- Impressions et taux de clic des miniatures : non fournis par l'API YouTube Analytics (visibles seulement dans YouTube Studio).
