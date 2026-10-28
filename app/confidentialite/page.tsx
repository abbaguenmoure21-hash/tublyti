import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Confidentialité',
  description: 'Les données que TubLyTI utilise, pourquoi, et comment les supprimer.',
};

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

/** Politique de confidentialité (exigée par Google pour la connexion YouTube). */
export default function ConfidentialitePage() {
  const updated = '5 octobre 2026';
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-[68px] max-w-[760px] items-center px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">T</span>
            <span className="text-lg font-semibold tracking-[-0.01em]">TubLyTI</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-[760px] flex-col gap-8 px-6 py-12 text-[15px] leading-relaxed">
        <div className="flex flex-col gap-2">
          <h1 className="text-[32px] font-semibold tracking-[-0.02em]">Confidentialité</h1>
          <p className="text-muted-foreground">Mise à jour le {updated}.</p>
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Ce que TubLyTI enregistre</h2>
          <p>Ton adresse e-mail (pour te connecter et t’envoyer le résumé du dimanche et tes alertes), ton nom affiché, les chaînes YouTube que tu ajoutes, les thématiques que tu suis, tes favoris, tes alertes et les vidéos que tu prépares dans « Mes vidéos ».</p>
          <p>Pour chaque chaîne ajoutée, TubLyTI lit ses informations publiques sur YouTube : nom, photo, nombre d’abonnés, vidéos publiées et leurs vues. Ces données publiques servent à calculer tes résultats.</p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Connexion avec Google</h2>
          <p>
            Si tu choisis « Avec Google » pour ajouter ta chaîne, TubLyTI demande un accès en lecture seule à YouTube
            (<code className="rounded bg-muted px-1 text-[13px]">youtube.readonly</code>) dans un seul but : lister les chaînes de ton compte pour prouver
            qu’elles t’appartiennent.
          </p>
          <p>
            L’accès est utilisé une seule fois, puis révoqué aussitôt. TubLyTI n’enregistre pas le jeton Google, ne lit pas tes vidéos privées, tes
            statistiques privées ni tes commentaires, et ne publie rien sur ta chaîne. Seuls l’identifiant public, le nom, la photo et le nombre
            d’abonnés des chaînes que tu choisis d’ajouter sont enregistrés.
          </p>
          <p>
            Si tu connectes ensuite YouTube Analytics depuis la page « Ma chaîne », TubLyTI demande en plus un accès en lecture seule à tes
            statistiques (<code className="rounded bg-muted px-1 text-[13px]">yt-analytics.readonly</code>) et, si tu l’acceptes, à tes revenus
            (<code className="rounded bg-muted px-1 text-[13px]">yt-analytics-monetary.readonly</code>). Pour afficher ces chiffres sans te redemander
            l’accès à chaque visite, TubLyTI conserve un jeton d’actualisation chiffré (AES-256-GCM), lié à cette seule chaîne et lisible uniquement
            par le serveur. Les statistiques sont gardées en cache 6 heures au plus, ne sont montrées qu’à toi, ne sont jamais revendues ni utilisées
            pour la publicité ou pour entraîner une IA. Le bouton « Déconnecter » révoque le jeton chez Google et efface le jeton et les chiffres en
            cache ; retirer ta chaîne ou ton compte les efface aussi.
          </p>
          <p>
            L’utilisation et le transfert par TubLyTI des informations reçues des API Google respectent les{' '}
            <a className="text-primary underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
              règles de Google sur les données des utilisateurs des services API
            </a>
            , y compris les exigences d’utilisation limitée.
          </p>
          <p>
            TubLyTI utilise les services API de YouTube. En les utilisant, tu acceptes les{' '}
            <a className="text-primary underline" href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">conditions d’utilisation de YouTube</a>.
            Les données traitées par Google le sont selon les{' '}
            <a className="text-primary underline" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">règles de confidentialité de Google</a>.
            Tu peux retirer à tout moment l’accès accordé à TubLyTI depuis la{' '}
            <a className="text-primary underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">page de sécurité de ton compte Google</a>.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Ce que TubLyTI ne fait pas</h2>
          <p>TubLyTI ne vend pas tes données et n’affiche pas de publicité. Tes chaînes, favoris, alertes et vidéos ne sont visibles par aucun autre client.</p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Supprimer tes données</h2>
          <p>
            Tu peux retirer une chaîne à tout moment dans Réglages › Mes chaînes. Pour supprimer ton compte et toutes ses données,
            {CONTACT ? (
              <>
                {' '}écris à <a className="text-primary underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
              </>
            ) : (
              ' réponds à n’importe quel e-mail de TubLyTI.'
            )}{' '}
            La suppression est faite sous 30 jours.
          </p>
        </section>

        <p className="text-sm text-muted-foreground">
          <Link href="/" className="text-primary">Retour à l’accueil</Link>
        </p>
      </main>
    </div>
  );
}
