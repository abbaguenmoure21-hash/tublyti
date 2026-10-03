import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, ArrowLeft } from 'lucide-react';
import { WaitlistForm } from '@/components/landing/waitlist-form';

export const metadata: Metadata = {
  title: 'Rejoindre la liste d’attente · TubLyTI',
  description: 'Inscris-toi pour recevoir ton accès à TubLyTI pendant la bêta.',
};

const OFFERS: Record<string, string> = {
  createur: 'Créateur',
  studio: 'Studio',
  agence: 'Agence',
};

const PROMISES = [
  'Ton accès arrive par e-mail, par groupes, pendant la bêta.',
  'Aucun paiement demandé pour t’inscrire.',
  'Les inscrits gardent un tarif réduit à vie.',
];

/** Nettoie un paramètre d'adresse pour l'enregistrer comme provenance (lettres, chiffres, tirets). */
function clean(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  const s = v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
  return s || null;
}

/**
 * Page d'inscription dédiée, pour toutes les entrées qui ne passent pas par le champ e-mail
 * de la page d'accueil : menu, boutons des offres, page de connexion, liens partagés.
 */
export default async function ListeAttentePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const offerKey = clean(params.offre);
  const offer = offerKey && OFFERS[offerKey] ? offerKey : null;
  const from = clean(params.source) ?? 'direct';
  const source = offer ? `page-offre-${offer}` : `page-${from}`;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1160px] items-center gap-6 px-6">
          <Link href="/" className="flex items-center gap-2.5 text-foreground">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">T</span>
            <span className="text-lg font-semibold tracking-[-0.01em]">TubLyTI</span>
          </Link>
          <div className="flex-1" />
          <Link href="/login" className="text-[15px] font-medium text-foreground hover:text-primary">
            Se connecter
          </Link>
        </div>
      </header>

      <main id="contenu" className="flex flex-1 items-center px-6 py-14 md:py-20">
        <div className="mx-auto grid w-full max-w-[1040px] items-center gap-12 md:grid-cols-[1.1fr_1fr]">
          <section aria-labelledby="titre" className="flex flex-col gap-6">
            <Link href="/" className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Découvrir TubLyTI
            </Link>
            <div className="flex flex-col gap-3">
              {offer && (
                <span className="inline-flex h-7 items-center self-start rounded-full bg-primary-soft px-3 text-[13px] font-semibold text-primary-ink">
                  Offre {OFFERS[offer]}
                </span>
              )}
              <h1 id="titre" className="text-balance text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
                Rejoins la liste d’attente
              </h1>
              <p className="max-w-[520px] text-lg leading-relaxed text-muted-foreground">
                TubLyTI te montre les sujets que ton public réclame, avant que d’autres chaînes ne les traitent. Laisse ton adresse : on t’écrit dès que ton accès est prêt.
              </p>
            </div>

            <WaitlistForm source={source} />

            <ul className="flex flex-col gap-2.5">
              {PROMISES.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-[15px] leading-snug">
                  <Check className="mt-0.5 h-[18px] w-[18px] shrink-0 text-phase-2" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
          </section>

          {/* Aperçu illustratif : sujets et chaînes fictifs */}
          <aside aria-label="Aperçu de l’application (exemple)" className="hidden md:block">
            <div className="elev-3 flex flex-col gap-3 rounded-[22px] bg-card p-5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">Tes meilleurs sujets cette semaine</span>
                <span className="text-xs text-muted-foreground">Exemple</span>
              </div>
              {[
                { label: 'Budget 50/30/20 expliqué simplement', ch: 'Money Compass', moment: 'C’est le moment', tone: 'bg-phase-2-soft text-phase-2-ink', pot: 87 },
                { label: 'Agents IA locaux sur un ordinateur portable', ch: 'Signal AI', moment: 'Ça monte', tone: 'bg-phase-1-soft text-phase-1-ink', pot: 74 },
                { label: 'Pourquoi le cerveau cherche la certitude', ch: 'Longevity Lab', moment: 'À surveiller', tone: 'bg-muted text-muted-foreground', pot: 61 },
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-3 rounded-xl bg-background px-3.5 py-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">{r.label}</span>
                    <span className="text-xs text-muted-foreground">{r.ch}</span>
                  </span>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${r.tone}`}>{r.moment}</span>
                  <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">{r.pot}</span>
                </div>
              ))}
              <p className="px-1 text-xs leading-relaxed text-muted-foreground">
                Chaque sujet indique s’il faut publier maintenant, son potentiel sur 100 et ce que réclame le public dans les commentaires.
              </p>
            </div>
          </aside>
        </div>
      </main>

      <footer className="border-t border-border bg-card px-6 py-6">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">TubLyTI</span>
          <span>© {new Date().getFullYear()}</span>
          <div className="flex-1" />
          <Link href="/" className="hover:text-foreground">Accueil</Link>
          <Link href="/login" className="hover:text-foreground">Se connecter</Link>
        </div>
      </footer>
    </div>
  );
}
