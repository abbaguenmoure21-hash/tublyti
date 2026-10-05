import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BarChart3,
  Check,
  KanbanSquare,
  MessageSquareText,
  MousePointerClick,
  Plug,
  ScatterChart,
} from 'lucide-react';
import { PhaseBadge } from '@/components/tublyti/phase-badge';
import { WaitlistForm } from '@/components/landing/waitlist-form';

export const metadata: Metadata = {
  title: { absolute: 'TubLyTI · Les sujets de vidéos que ton public attend' },
  description:
    'TubLyTI repère les sujets de vidéos YouTube que les spectateurs réclament et que peu de chaînes traitent encore. Chaque semaine, une liste claire pour choisir ta prochaine vidéo.',
};

/* Exemples illustratifs pour l'aperçu : ne jamais exposer les vrais sujets de la base sur une page publique. */
const PREVIEW = [
  { title: 'Tax strategies for a normal salary', niche: 'Finance personnelle', phase: 2, mgi: 94 },
  { title: 'Housing market: what changes in 2027', niche: 'Finance personnelle', phase: 2, mgi: 88 },
  { title: 'Claude for non-coders, start to finish', niche: 'IA et automatisation', phase: 1, mgi: 84 },
  { title: 'Habits that quietly drain your energy', niche: 'Psychologie', phase: 1, mgi: 79 },
];

const PROBLEMS = [
  {
    title: 'Tu arrives après tout le monde',
    text: "Quand un sujet apparaît dans les tendances, des dizaines de chaînes l'ont déjà traité. Ta vidéo sort au moment où l'intérêt retombe.",
  },
  {
    title: "Un sujet populaire n'est pas forcément un bon sujet",
    text: "Si d'excellentes vidéos existent déjà, la tienne aura du mal à être vue. Un sujet très demandé et encore mal traité rapporte plus.",
  },
  {
    title: 'Tes spectateurs te disent quelle vidéo manque',
    text: '« Personne n’explique… », « J’aimerais une vidéo sur… » : les commentaires indiquent précisément ce que le public cherche sans le trouver.',
  },
];

const STEPS = [
  { title: 'Choisis ta niche', text: 'Finance, psychologie, IA, business, histoire ou santé. Ajoute ta chaîne si tu veux comparer tes résultats à ceux des autres.' },
  { title: 'Consulte ta liste chaque lundi', text: 'La page « Sujets » classe les sujets du moment, du plus prometteur au moins prometteur.' },
  { title: 'Prépare ta vidéo', text: 'Ouvre un sujet : tu y trouves les questions des spectateurs, les vidéos qui marchent déjà, et des idées d’angle et de titre.' },
  { title: 'Mesure le résultat', text: 'Une fois ta vidéo publiée, TubLyTI compare ses vues, une semaine puis un mois plus tard, à la moyenne de ta niche.' },
];

const PHASES = [
  { phase: 2, text: 'Le public demande et peu de bonnes vidéos existent. Crée ta vidéo maintenant.' },
  { phase: 1, text: 'L’intérêt grimpe vite. Garde le sujet de côté et surveille-le.' },
  { phase: 0, text: 'Le sujet commence à apparaître. Tu es prévenu s’il prend de l’ampleur.' },
  { phase: 3, text: 'Beaucoup de bonnes vidéos existent déjà. Choisis un autre sujet ou un angle très différent.' },
];

const FEATURES = [
  { icon: ScatterChart, title: 'Trouver les sujets peu traités', text: 'Une carte place chaque sujet selon la demande et le nombre de vidéos existantes. Les meilleures occasions apparaissent en haut à gauche.' },
  { icon: MessageSquareText, title: 'Partir des questions du public', text: 'Lis les commentaires qui réclament une vidéo, avec leur nombre de likes, pour écrire un script qui y répond.' },
  { icon: BarChart3, title: 'Choisir un angle et un titre', text: 'Pour chaque sujet, des idées d’angle et des modèles de titres qui fonctionnent déjà dans ta niche.' },
  { icon: KanbanSquare, title: 'Suivre tes vidéos en cours', text: 'Classe tes sujets de « Idée » à « Publiée » et vois en un seul écran où en est chaque vidéo.' },
  { icon: MousePointerClick, title: 'Analyser une vidéo depuis YouTube', text: 'Avec l’extension Chrome, ouvre n’importe quelle vidéo : TubLyTI t’indique si son sujet vaut encore la peine.' },
  { icon: Plug, title: 'Poser tes questions à Claude', text: 'Connecte TubLyTI à Claude et demande simplement : « Quels sujets choisir cette semaine pour ma chaîne finance ? »' },
];

const TIERS = [
  { name: 'Créateur', slug: 'createur', desc: 'Pour une chaîne.', items: ['1 niche', '150 chaînes concurrentes suivies', 'Résumé par e-mail chaque dimanche', 'Extension Chrome'] },
  { name: 'Studio', slug: 'studio', desc: 'Pour gérer plusieurs chaînes.', items: ['3 niches', '600 chaînes concurrentes suivies', 'Idées d’angles et de titres', 'Suivi de production', 'Connexion à Claude'], featured: true },
  { name: 'Agence', slug: 'agence', desc: 'Pour les équipes.', items: ['Niches illimitées', 'Plusieurs utilisateurs', 'Export des fiches sujets en PDF', 'Assistance prioritaire'] },
];

const FAQ = [
  { q: 'Combien de temps faut-il y consacrer ?', a: 'Environ dix minutes le lundi pour choisir tes sujets, puis quelques minutes par vidéo pour lire la fiche du sujet avant d’écrire.' },
  { q: 'Je débute sur YouTube. Est-ce utile pour moi ?', a: 'Oui. Tu pars de sujets qui ont déjà un public au lieu de deviner. Commence par ceux marqués « C’est le moment ».' },
  { q: 'Quelles niches sont disponibles ?', a: 'Finance personnelle, psychologie et développement personnel, IA et automatisation, business et études de cas, histoire et géopolitique, santé et longévité. D’autres niches arriveront pendant la bêta.' },
  { q: 'Dois-je connecter ma chaîne YouTube ?', a: 'Non, c’est facultatif. Cela sert uniquement à comparer tes vidéos à celles de ta niche.' },
  { q: 'Quand aurai-je accès ?', a: 'Les inscrits de la liste d’attente reçoivent leur accès par e-mail, par groupes, pendant la bêta.' },
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-primary-ink">{children}</span>;
}

function SectionTitle({ title, sub, center = false }: { title: string; sub?: string; center?: boolean }) {
  return (
    <div className={`flex flex-col gap-3.5 ${center ? 'items-center text-center' : ''}`}>
      <h2 className="text-balance text-[clamp(1.75rem,3.2vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.025em]">{title}</h2>
      {sub && <p className="max-w-[680px] text-lg leading-relaxed text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-foreground">
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">T</span>
      <span className="text-lg font-semibold tracking-[-0.01em]">TubLyTI</span>
    </Link>
  );
}

export default async function LandingPage() {

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        Aller au contenu
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1160px] items-center gap-8 px-6">
          <Logo />
          <nav aria-label="Sections" className="hidden gap-7 text-[15px] font-medium text-muted-foreground md:flex">
            <a href="#fonctionnement" className="hover:text-foreground">Comment l’utiliser</a>
            <a href="#fonctionnalites" className="hover:text-foreground">Ce que tu peux faire</a>
            <a href="#tarifs" className="hover:text-foreground">Tarifs</a>
            <a href="#faq" className="hover:text-foreground">FAQ</a>
          </nav>
          <div className="flex-1" />
          <Link href="/login" className="text-[15px] font-medium text-foreground hover:text-primary">Se connecter</Link>
          <Link href="/liste-attente?source=menu" className="hidden h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 sm:inline-flex">
            Rejoindre la liste
          </Link>
        </div>
      </header>

      <main id="contenu">
        {/* Hero */}
        <section className="px-6 pb-14 pt-16 md:pt-[72px]">
          <div className="mx-auto grid max-w-[1160px] items-center gap-14 lg:grid-cols-2">
            <div className="flex flex-col gap-6">
              <span className="inline-flex h-[30px] items-center gap-2 self-start rounded-full bg-primary-soft px-3 text-[13px] font-medium text-primary-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Pour les créateurs de chaînes YouTube éducatives
              </span>
              <h1 className="text-balance text-[clamp(2.4rem,5vw,4rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
                Publie les vidéos que ton public attend, avant les autres.
              </h1>
              <p className="max-w-[560px] text-[1.2rem] leading-relaxed text-muted-foreground">
                Choisis ta niche. Chaque semaine, TubLyTI te montre les sujets les plus demandés et encore peu traités, avec les questions exactes que posent les spectateurs.
              </p>
              <div id="liste" className="scroll-mt-24">
                <WaitlistForm source="hero" />
              </div>
              <span className="text-sm text-muted-foreground">Accès gratuit pendant la bêta. Aucune carte bancaire demandée.</span>
            </div>

            {/* Aperçu produit (exemples illustratifs) */}
            <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_24px_60px_rgba(20,24,34,0.12),0_2px_6px_rgba(20,24,34,0.06)]" aria-label="Aperçu de l’écran Aujourd’hui">
              <div className="flex h-10 items-center gap-2 border-b border-border bg-background px-4">
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="h-2.5 w-2.5 rounded-full bg-border" />
                <span className="ml-3 text-xs text-muted-foreground">Aujourd’hui · aperçu</span>
              </div>
              <div className="flex flex-col gap-1 px-4 pb-2 pt-5">
                <span className="text-xl font-semibold tracking-[-0.01em]">Tes meilleurs sujets cette semaine</span>
                <span className="text-sm text-muted-foreground">Classés du plus prometteur au moins prometteur</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3.5 px-4 py-2 text-xs text-muted-foreground">
                <span>Sujet</span><span>Moment</span><span>Potentiel</span>
              </div>
              {PREVIEW.map((row) => (
                <div key={row.title} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3.5 border-t border-muted px-4 py-3">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold">{row.title}</span>
                    <span className="text-xs text-muted-foreground">{row.niche}</span>
                  </span>
                  <PhaseBadge phase={row.phase} />
                  <span className="flex items-center gap-2">
                    <span className="block h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                      <span className="block h-1.5 rounded-full bg-primary" style={{ width: `${row.mgi}%` }} />
                    </span>
                    <span className="w-6 text-right text-sm font-semibold tabular-nums">{row.mgi}</span>
                  </span>
                </div>
              ))}
              <div className="m-4 mt-3 rounded-[10px] border border-border bg-background px-3.5 py-3 text-[13px] leading-relaxed">
                <span className="font-semibold">Question posée par les spectateurs : </span>
                « No one explains how the tax brackets actually stack up for a normal salary. »
              </div>
            </div>
          </div>
        </section>

        {/* Problème */}
        <section className="px-6 py-24">
          <div className="mx-auto flex max-w-[1160px] flex-col gap-10">
            <SectionTitle
              center
              title="Choisir un sujet au hasard coûte cher."
              sub="Une vidéo demande des heures de travail. TubLyTI t’aide à les consacrer à un sujet qui a déjà un public."
            />
            <div className="grid gap-4 md:grid-cols-3">
              {PROBLEMS.map((p) => (
                <div key={p.title} className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-card p-6 shadow-sm">
                  <h3 className="text-lg font-semibold">{p.title}</h3>
                  <p className="text-[15px] leading-relaxed text-muted-foreground">{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Comment l'utiliser */}
        <section id="fonctionnement" className="scroll-mt-20 px-6 pb-24">
          <div className="mx-auto flex max-w-[1160px] flex-col gap-10">
            <div className="flex flex-col gap-3">
              <Eyebrow>Comment l’utiliser</Eyebrow>
              <SectionTitle title="Quatre étapes, dix minutes par semaine" />
            </div>
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary-soft font-semibold text-primary-ink">{i + 1}</span>
                  <h3 className="text-[1.0625rem] font-semibold">{s.title}</h3>
                  <p className="text-[15px] leading-relaxed text-muted-foreground">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Lire les résultats */}
        <section className="bg-card px-6 py-24">
          <div className="mx-auto grid max-w-[1160px] items-center gap-12 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Eyebrow>Lire les résultats</Eyebrow>
              <SectionTitle
                title="Chaque sujet te dit quoi faire."
                sub="Une étiquette de couleur indique le bon moment. Le potentiel, de 0 à 100, mesure l’intérêt du sujet : plus il est élevé, mieux c’est."
              />
            </div>
            <ul className="flex flex-col gap-3">
              {PHASES.map((p) => (
                <li key={p.phase} className="flex items-center gap-4 rounded-[10px] border border-border bg-card px-[18px] py-4 shadow-sm">
                  <span className="shrink-0"><PhaseBadge phase={p.phase} /></span>
                  <span className="text-[15px] leading-normal">{p.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Fonctionnalités */}
        <section id="fonctionnalites" className="scroll-mt-20 px-6 py-24">
          <div className="mx-auto flex max-w-[1160px] flex-col gap-10">
            <div className="flex flex-col gap-3">
              <Eyebrow>Ce que tu peux faire</Eyebrow>
              <SectionTitle title="Du choix du sujet à la vidéo publiée" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-6 shadow-sm">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary-soft text-primary-ink">
                    <f.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="text-[1.0625rem] font-semibold">{f.title}</h3>
                  <p className="text-[15px] leading-relaxed text-muted-foreground">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Tarifs */}
        <section id="tarifs" className="scroll-mt-20 bg-card px-6 py-24">
          <div className="mx-auto flex max-w-[1160px] flex-col gap-10">
            <div className="flex flex-col gap-3">
              <Eyebrow>Tarifs</Eyebrow>
              <SectionTitle
                title="Un tarif selon le nombre de niches"
                sub="Les prix seront annoncés à la fin de la bêta. Les inscrits de la liste d’attente garderont un tarif réduit à vie."
              />
            </div>
            <div className="grid items-start gap-4 md:grid-cols-3">
              {TIERS.map((t) => (
                <div
                  key={t.name}
                  className={`flex flex-col gap-[18px] rounded-[14px] bg-card p-7 ${t.featured ? 'border-2 border-primary' : 'border border-border'}`}
                >
                  {t.featured && (
                    <span className="inline-flex h-6 items-center self-start rounded-full bg-primary px-2.5 text-xs font-semibold text-primary-foreground">Recommandé</span>
                  )}
                  <h3 className="text-xl font-semibold">{t.name}</h3>
                  <p className="text-2xl font-semibold tracking-[-0.01em]">Prix à venir</p>
                  <p className="text-[15px] leading-normal text-muted-foreground">{t.desc}</p>
                  <Link
                    href={`/liste-attente?offre=${t.slug}`}
                    className={`inline-flex h-11 items-center justify-center rounded-lg text-sm font-medium ${
                      t.featured ? 'bg-primary text-primary-foreground hover:opacity-90' : 'border border-border bg-card hover:bg-muted'
                    }`}
                  >
                    Rejoindre la liste
                  </Link>
                  <ul className="flex flex-col gap-2.5">
                    {t.items.map((it) => (
                      <li key={it} className="flex gap-2.5 text-[15px] leading-snug">
                        <Check className="mt-0.5 h-[18px] w-[18px] shrink-0 text-phase-2" aria-hidden="true" />
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 px-6 py-24">
          <div className="mx-auto flex max-w-[1160px] flex-col gap-10">
            <div className="flex flex-col gap-3">
              <Eyebrow>FAQ</Eyebrow>
              <SectionTitle title="Questions fréquentes" />
            </div>
            <div className="border-t border-border">
              {FAQ.map((f) => (
                <details key={f.q} className="group border-b border-border py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[1.0625rem] font-semibold [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span aria-hidden="true" className="text-xl text-muted-foreground transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 max-w-[820px] text-[15px] leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Appel final */}
        <section className="bg-[#141822] px-6 py-24">
          <div className="mx-auto flex max-w-[760px] flex-col items-center gap-7 text-center">
            <h2 className="text-balance text-[clamp(1.75rem,3.2vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.025em] text-white">
              Ton prochain sujet est déjà dans les commentaires.
            </h2>
            <p className="text-lg text-[#c9ccd6]">Inscris-toi à la liste d’attente pour recevoir ton accès pendant la bêta.</p>
            <WaitlistForm source="footer" tone="dark" />
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card px-6 py-8">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-x-8 gap-y-4 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">TubLyTI</span>
          <span>© {new Date().getFullYear()}</span>
          <div className="flex-1" />
          <Link href="/confidentialite" className="hover:text-foreground">Confidentialité</Link>
          <Link href="/login" className="hover:text-foreground">Se connecter</Link>
        </div>
      </footer>
    </div>
  );
}
