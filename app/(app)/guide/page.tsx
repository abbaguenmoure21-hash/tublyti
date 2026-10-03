import type { Metadata } from 'next';
import Link from 'next/link';
import { PhaseBadge } from '@/components/tublyti/phase-badge';

export const metadata: Metadata = { title: 'Aide' };

const ROUTINE = [
  {
    when: 'Une seule fois · 1 minute',
    title: 'Ajoute tes chaînes',
    text: 'Dans « Réglages », indique le nom de chaque chaîne et sa thématique. Tu peux aussi suivre une thématique sans y avoir de chaîne.',
    href: '/settings#chaines',
    cta: 'Ajouter mes chaînes',
  },
  {
    when: 'Le lundi · 10 minutes',
    title: 'Choisis tes sujets de la semaine',
    text: 'Ouvre « Sujets ». Clique sur un sujet marqué « C’est le moment » et « Fiable » : sa fiche s’ouvre à droite. Choisis un angle, puis « Créer cette vidéo ».',
    href: '/sujets',
    cta: 'Ouvrir Sujets',
  },
  {
    when: 'Pendant la semaine',
    title: 'Fais avancer tes vidéos',
    text: 'Dans « Mes vidéos », fais glisser chaque vidéo d’une colonne à l’autre, de l’idée à la publication.',
    href: '/pipeline',
    cta: 'Ouvrir Mes vidéos',
  },
  {
    when: 'Une semaine puis un mois après publication',
    title: 'Mesure le résultat',
    text: 'L’onglet « Résultats » de Mes vidéos compare les vues de chaque vidéo à ta moyenne habituelle.',
    href: '/my-channel',
    cta: 'Voir les résultats',
  },
];

const SPACES = [
  {
    name: 'Sujets',
    href: '/sujets',
    question: 'Quels sujets choisir ?',
    use: 'Ta liste de départ, classée par potentiel. Onglets : Liste, Carte (les sujets peu traités sont en haut à gauche) et Questions du public.',
  },
  {
    name: 'Mes vidéos',
    href: '/pipeline',
    question: 'Où en sont mes vidéos ?',
    use: 'Onglet Tableau pour suivre chaque vidéo de l’idée à la publication, onglet Résultats pour voir ce qu’elles ont rapporté.',
  },
  {
    name: 'Veille',
    href: '/activity',
    question: 'Que se passe-t-il dans ma niche ?',
    use: 'Les vidéos de tes thématiques à regarder cette semaine : changements de titre ou de miniature, vidéos qui surperforment.',
  },
];

const SHORTCUTS = [
  ['⌘K', 'Rechercher partout'],
  ['/', 'Chercher un sujet dans la liste'],
  ['J / K', 'Sujet suivant / précédent'],
  ['Entrée', 'Ouvrir le premier sujet'],
  ['C', 'Créer la vidéo du sujet ouvert'],
  ['X', 'Ignorer le sujet ouvert'],
  ['Échap', 'Fermer le panneau'],
];

const PHASES = [
  { phase: 2, text: 'Le public demande et peu de bonnes vidéos existent. Crée ta vidéo maintenant.' },
  { phase: 1, text: 'L’intérêt grimpe vite. Garde le sujet de côté et surveille-le.' },
  { phase: 0, text: 'Le sujet commence à apparaître. Tu es prévenu s’il prend de l’ampleur.' },
  { phase: 3, text: 'Beaucoup de bonnes vidéos existent déjà. Choisis un autre sujet ou un angle très différent.' },
];

const TERMS = [
  { term: 'Potentiel (0 à 100)', def: 'L’intérêt d’un sujet comparé aux autres sujets de ta niche. 100 = le plus intéressant en ce moment.' },
  { term: 'Fiabilité', def: 'La quantité de données derrière le potentiel. « Fiable » : beaucoup de vidéos et de commentaires analysés. « Peu de données » : à prendre avec prudence.' },
  { term: 'Questions du public', def: 'Les commentaires qui réclament une vidéo, signalent une explication manquante ou une vidéo trop courte.' },
  { term: 'Vidéo qui surperforme', def: 'Une vidéo qui fait au moins 3 fois plus de vues que la moyenne habituelle de sa chaîne. Signe qu’un sujet plaît.' },
  { term: 'Sujet sensible', def: 'Un sujet délicat (santé mentale grave, par exemple). Il reste visible mais n’apparaît jamais dans tes recommandations.' },
  { term: 'Afficher (barre latérale)', def: 'Choisis une de tes chaînes pour ne voir que ses sujets, partout dans l’app. « Toutes mes chaînes » pour tout voir.' },
];

export default function GuidePage() {
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-12 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">Comment utiliser TubLyTI</h1>
        <p className="text-[15px] text-muted-foreground">
          Dix minutes par semaine pour choisir des sujets que ton public attend. Voici la marche à suivre et ce que veut dire chaque mot.
        </p>
      </header>

      <section aria-labelledby="routine" className="flex flex-col gap-4">
        <h2 id="routine" className="text-lg font-semibold">Ta semaine type</h2>
        <ol className="grid gap-3 md:grid-cols-2">
          {ROUTINE.map((r, i) => (
            <li key={r.title} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 shadow-sm">
              <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary-soft text-xs font-semibold text-primary-ink">{i + 1}</span>
                {r.when}
              </span>
              <h3 className="text-[15px] font-semibold">{r.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{r.text}</p>
              <Link href={r.href} className="mt-auto pt-1 text-sm font-medium text-primary hover:text-primary-ink">
                {r.cta} →
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="espaces" className="flex flex-col gap-4">
        <h2 id="espaces" className="text-lg font-semibold">Les trois espaces</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {SPACES.map((s) => (
            <Link key={s.href} href={s.href} className="grid gap-1 border-b border-muted px-5 py-4 last:border-b-0 hover:bg-muted md:grid-cols-[200px_1fr]">
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">{s.name}</span>
                <span className="text-xs text-muted-foreground">{s.question}</span>
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">{s.use}</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="moments" className="flex flex-col gap-4">
        <h2 id="moments" className="text-lg font-semibold">Les quatre étiquettes de moment</h2>
        <p className="text-sm text-muted-foreground">Chaque sujet porte une étiquette qui te dit quoi faire.</p>
        <ul className="flex flex-col gap-2">
          {PHASES.map((p) => (
            <li key={p.phase} className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
              <span className="w-[130px] shrink-0"><PhaseBadge phase={p.phase} /></span>
              <span className="text-sm">{p.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="raccourcis" className="flex flex-col gap-4">
        <h2 id="raccourcis" className="text-lg font-semibold">Raccourcis clavier</h2>
        <dl className="grid gap-x-8 gap-y-2 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 border-b border-muted py-1.5 text-sm last:border-b-0">
              <dt className="text-muted-foreground">{v}</dt>
              <dd><kbd className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs">{k}</kbd></dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="lexique" className="flex flex-col gap-4">
        <h2 id="lexique" className="text-lg font-semibold">Lexique</h2>
        <dl className="grid gap-3 md:grid-cols-2">
          {TERMS.map((t) => (
            <div key={t.term} className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
              <dt className="text-sm font-semibold">{t.term}</dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{t.def}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
