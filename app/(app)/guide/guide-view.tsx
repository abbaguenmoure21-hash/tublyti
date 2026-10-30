'use client';

import { smoothScrollIntoView } from '@/lib/ui/smooth-scroll';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Search, X } from 'lucide-react';
import { MGI_SCALE } from '@/components/tublyti/mgi-scale';
import { PhaseBadge } from '@/components/tublyti/phase-badge';
import { SectionNav } from '@/components/app-shell/section-nav';
import { PageSection } from '@/components/app-shell/page-section';
import { FAQ, FAQ_GROUPS, FEASIBILITY, LABELS, OUTLIERS, PHASES, POTENTIAL, ROUTINE, SHORTCUTS, SPACES, TERMS } from './content';

const NAV = [
  { id: 'demarrer', label: 'Bien démarrer', icon: 'rocket' },
  { id: 'espaces', label: 'Les espaces', icon: 'compass' },
  { id: 'moments', label: 'Étiquettes de moment', icon: 'trend' },
  { id: 'faisabilite', label: 'Faisabilité (A à F)', icon: 'letters' },
  { id: 'potentiel', label: 'Potentiel', icon: 'gauge' },
  { id: 'surperformance', label: 'Surperformance', icon: 'sparkles' },
  { id: 'questions', label: 'Questions du public', icon: 'quote' },
  { id: 'lexique', label: 'Lexique', icon: 'book' },
  { id: 'faq', label: 'Questions fréquentes', icon: 'help' },
  { id: 'raccourcis', label: 'Raccourcis clavier', icon: 'keyboard' },
];

const POPULAR = ['Faisabilité', 'Potentiel', 'Bonne vidéo', 'Revenus', 'Chaîne vérifiée', 'Pas encore mesuré'];

/** Stable anchor for a lexicon term (e.g. « Chaîne vérifiée » → terme-chaine-verifiee). */
const termId = (term: string) =>
  `terme-${term
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

/** Tout le contenu à plat, pour la recherche. */
type Entry = { section: string; anchor: string; title: string; text: string };
const INDEX: Entry[] = [
  ...ROUTINE.map((r) => ({ section: 'Bien démarrer', anchor: 'demarrer', title: r.title, text: r.text })),
  ...SPACES.map((s) => ({ section: 'Les espaces', anchor: 'espaces', title: s.name, text: `${s.question} ${s.use}` })),
  ...PHASES.map((p) => ({ section: 'Étiquettes de moment', anchor: 'moments', title: p.name, text: p.text })),
  ...FEASIBILITY.map((f) => ({ section: 'Faisabilité', anchor: 'faisabilite', title: `${f.grade} · ${f.title}`, text: f.text })),
  ...POTENTIAL.map((p) => ({ section: 'Potentiel', anchor: 'potentiel', title: `Potentiel ${p.label.toLowerCase()}`, text: `De ${p.range}.` })),
  ...OUTLIERS.map((o) => ({ section: 'Surperformance', anchor: 'surperformance', title: o.badge, text: o.text })),
  ...LABELS.map((l) => ({ section: 'Questions du public', anchor: 'questions', title: l.name, text: l.text })),
  ...TERMS.map((t) => ({ section: 'Lexique', anchor: termId(t.term), title: t.term, text: t.def })),
  ...FAQ.map((f) => ({ section: 'Questions fréquentes', anchor: `faq-${f.id}`, title: f.q, text: f.a })),
  ...SHORTCUTS.map(([k, v]) => ({ section: 'Raccourcis clavier', anchor: 'raccourcis', title: v, text: `Touche ${k}` })),
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ');

function search(q: string): Entry[] {
  const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  return INDEX.map((e) => {
    const title = norm(e.title);
    const body = norm(`${e.title} ${e.text} ${e.section}`);
    if (!words.every((w) => body.includes(w))) return null;
    const score = words.reduce((s, w) => s + (title.includes(w) ? 3 : 1), 0);
    return { e, score };
  })
    .filter((x): x is { e: Entry; score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);
}

function Highlight({ text, q }: { text: string; q: string }) {
  const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return <>{text}</>;
  // Surligne sur le texte normalisé (même longueur que l'original pour les lettres latines).
  const n = norm(text);
  const marks: [number, number][] = [];
  for (const w of words) {
    let i = n.indexOf(w);
    while (i >= 0) {
      marks.push([i, i + w.length]);
      i = n.indexOf(w, i + w.length);
    }
  }
  if (!marks.length || n.length !== text.length) return <>{text}</>;
  marks.sort((a, b) => a[0] - b[0]);
  const out: React.ReactNode[] = [];
  let pos = 0;
  marks.forEach(([a, b], k) => {
    if (a < pos) return;
    out.push(text.slice(pos, a));
    out.push(
      <mark key={k} className="rounded-sm bg-primary-soft px-0.5 text-primary-ink">
        {text.slice(a, b)}
      </mark>,
    );
    pos = b;
  });
  out.push(text.slice(pos));
  return <>{out}</>;
}

export function GuideView() {
  const [q, setQ] = useState('');
  const results = useMemo(() => search(q), [q]);
  const searching = q.trim().length > 1;
  const terms = useMemo(() => [...TERMS].sort((a, b) => a.term.localeCompare(b.term, 'fr')), []);

  /** Scroll to an entry, open it if it is a FAQ answer, and flash it briefly. */
  const reveal = (anchor: string) => {
    const el = document.getElementById(anchor);
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    smoothScrollIntoView(el, { block: 'center' });
    el.classList.add('bg-primary-soft');
    window.setTimeout(() => el.classList.remove('bg-primary-soft'), 1200);
  };

  const jump = (anchor: string) => {
    setQ('');
    // Wait for the guide to render again (the search results replace it).
    requestAnimationFrame(() => requestAnimationFrame(() => reveal(anchor)));
  };

  // /guide#faq-verification (links from Réglages) opens the matching answer.
  useEffect(() => {
    const onHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id.startsWith('faq-') || id.startsWith('terme-')) reveal(id);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-6 md:px-8 md:py-8">
      {/* En-tête avec recherche, façon centre d'aide */}
      <header className="elev-1 mb-8 flex flex-col gap-4 rounded-3xl bg-card px-5 py-7 md:px-8 md:py-9">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] md:text-[34px]">Comment pouvons-nous t’aider ?</h1>
          <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
            Dix minutes par semaine suffisent pour choisir des sujets que ton public attend. Cherche un mot, ou parcours le guide.
          </p>
        </div>
        <div className="relative max-w-[560px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            placeholder="Faisabilité, revenus, vérification…"
            aria-label="Chercher dans l’aide"
            className="well h-12 w-full rounded-xl bg-background pl-10 pr-10 text-[15px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Effacer la recherche" className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">Souvent cherché :</span>
          {POPULAR.map((p) => (
            <button key={p} type="button" onClick={() => setQ(p)} className="rounded-full bg-muted px-3 py-1 font-medium text-foreground transition-colors hover:bg-primary-soft hover:text-primary-ink">
              {p}
            </button>
          ))}
        </div>
      </header>

      {searching ? (
        <section aria-live="polite" aria-label="Résultats de recherche" className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {results.length ? `${results.length} résultat${results.length > 1 ? 's' : ''} pour « ${q.trim()} »` : `Aucun résultat pour « ${q.trim()} ». Essaie un mot plus court, ou parcours le guide.`}
          </p>
          <ul className="flex flex-col gap-2">
            {results.map((r, i) => (
              <li key={`${r.anchor}-${i}`}>
                <button type="button" onClick={() => jump(r.anchor)} className="group flex w-full flex-col gap-1 rounded-2xl bg-card px-5 py-4 text-left transition-shadow hover:elev-2">
                  <span className="text-[12px] font-medium uppercase tracking-[0.04em] text-muted-foreground">{r.section}</span>
                  <span className="text-[15px] font-semibold">
                    <Highlight text={r.title} q={q} />
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    <Highlight text={r.text} q={q} />
                  </span>
                  <span className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-primary">
                    Voir dans le guide <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-10">
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <SectionNav label="Sommaire de l’aide" items={NAV} />
          </aside>

          <div className="flex min-w-0 flex-col gap-14">
            <PageSection id="demarrer" icon="rocket" title="Bien démarrer" description="Ta routine en quatre temps. Le reste de la page explique chaque mot que tu croiseras.">
              <ol className="relative flex flex-col gap-3 before:absolute before:bottom-6 before:left-[19px] before:top-6 before:w-px before:bg-border">
                {ROUTINE.map((r, i) => (
                  <li key={r.title} className="relative flex gap-4">
                    <span className="elev-1 z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-sm font-semibold text-primary">{i + 1}</span>
                    <div className="flex flex-1 flex-col gap-1 rounded-2xl bg-card px-4 py-3.5">
                      <span className="text-[12px] font-medium uppercase tracking-[0.04em] text-muted-foreground">{r.when}</span>
                      <h3 className="text-[15px] font-semibold">{r.title}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">{r.text}</p>
                      <Link href={r.href} className="mt-1 inline-flex items-center gap-1 self-start text-sm font-medium text-primary hover:underline">
                        {r.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
              <Link href="/bienvenue" className="inline-flex h-10 items-center gap-1.5 self-start rounded-[10px] border border-border bg-card px-4 text-sm font-medium hover:bg-muted">
                Revoir le parcours de bienvenue <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </PageSection>

            <PageSection id="espaces" icon="compass" title="Les espaces de l’app" description="Chaque espace répond à une question.">
              <div className="grid gap-3 sm:grid-cols-2">
                {SPACES.map((s) => (
                  <Link key={s.href} href={s.href} className="group flex flex-col gap-1 rounded-2xl bg-card px-4 py-4 transition-shadow hover:elev-2">
                    <span className="flex items-center justify-between text-[15px] font-semibold">
                      {s.name}
                      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                    <span className="text-[13px] font-medium text-primary">{s.question}</span>
                    <span className="text-sm leading-relaxed text-muted-foreground">{s.use}</span>
                  </Link>
                ))}
              </div>
            </PageSection>

            <PageSection id="moments" icon="trend" title="Les quatre étiquettes de moment" description="Chaque sujet porte une étiquette qui te dit quoi faire.">
              <ul className="overflow-hidden rounded-2xl bg-card">
                {PHASES.map((p) => (
                  <li key={p.phase} className="flex flex-col gap-2 border-b border-muted px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-[140px] shrink-0"><PhaseBadge phase={p.phase} /></span>
                    <span className="text-sm leading-relaxed">{p.text}</span>
                  </li>
                ))}
              </ul>
            </PageSection>

            <PageSection
              id="faisabilite"
              icon="letters"
              title="Les lettres de faisabilité (A à F)"
              description="Ta chaîne peut-elle se faire une place sur ce sujet ? TubLyTI compare la taille de ta chaîne aux chaînes qui ont publié de bonnes vidéos sur le sujet ces 90 derniers jours. Une même idée peut donc avoir A pour une chaîne et D pour une autre. Survole une lettre dans l’app pour lire la raison exacte."
            >
              <div className="flex flex-col gap-3">
                <div className="flex overflow-hidden rounded-full" aria-hidden="true">
                  {FEASIBILITY.map((f) => (
                    <span key={f.grade} className={`flex h-8 flex-1 items-center justify-center text-[13px] font-bold ${f.cls}`}>{f.grade}</span>
                  ))}
                </div>
                <div className="flex justify-between text-[12px] text-muted-foreground" aria-hidden="true">
                  <span>Facile</span>
                  <span>Difficile</span>
                </div>
                <ul className="overflow-hidden rounded-2xl bg-card">
                  {FEASIBILITY.map((f) => (
                    <li key={f.grade} className="flex items-start gap-4 border-b border-muted px-4 py-3.5 last:border-b-0">
                      <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${f.cls}`}>{f.grade}</span>
                      <span className="flex flex-col">
                        <span className="text-sm font-semibold">{f.title}</span>
                        <span className="text-sm leading-relaxed text-muted-foreground">{f.text}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[13px] text-muted-foreground">
                  Pas de lettre ?{' '}
                  <a href="#faq-faisabilite" className="font-medium text-primary hover:underline">Voir la réponse</a>.
                </p>
              </div>
            </PageSection>

            <PageSection
              id="potentiel"
              icon="gauge"
              title="Le potentiel (0 à 100)"
              description="Il combine la demande du public (recherches, vues, commentaires qui réclament une vidéo), le nombre de bonnes vidéos déjà en place et la vitesse à laquelle l’intérêt monte. Recalculé chaque nuit, il se lit par rapport aux autres sujets de la même thématique."
            >
              <div className="flex flex-col gap-2">
                <div className="flex h-3 overflow-hidden rounded-full" aria-hidden="true">
                  {MGI_SCALE.map((c) => (
                    <span key={c} className="flex-1" style={{ background: c }} />
                  ))}
                </div>
                <dl className="grid grid-cols-5 gap-1 text-center">
                  {[...POTENTIAL].reverse().map((p) => (
                    <div key={p.range} className="flex flex-col">
                      <dt className="text-[13px] font-semibold">{p.label}</dt>
                      <dd className="text-[12px] tabular-nums text-muted-foreground">{p.range}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </PageSection>

            <PageSection
              id="surperformance"
              icon="sparkles"
              title="Les badges de surperformance"
              description="Le badge compare les vues d’une vidéo à la médiane des 10 vidéos précédentes de sa chaîne. « Au même âge » : comparée à ces vidéos quand elles avaient le même nombre de jours, la mesure la plus juste. « Approximatif » : comparée à leurs vues actuelles, quand l’historique manque."
            >
              <ul className="grid gap-3 sm:grid-cols-2">
                {OUTLIERS.map((o) => (
                  <li key={o.badge} className="flex flex-col gap-2 rounded-2xl bg-card px-4 py-3.5">
                    <span className="self-start rounded-md bg-primary-soft px-2 py-0.5 text-[13px] font-semibold tabular-nums text-primary-ink">{o.badge}</span>
                    <span className="text-sm leading-relaxed text-muted-foreground">{o.text}</span>
                  </li>
                ))}
              </ul>
            </PageSection>

            <PageSection
              id="questions"
              icon="quote"
              title="Les types de questions du public"
              description="Chaque commentaire collecté est lu par l’IA et rangé dans un de ces types ; les compliments et discussions sont ignorés. Tu peux corriger un classement d’un clic dans « Questions du public »."
            >
              <dl className="grid gap-3 sm:grid-cols-2">
                {LABELS.map((l) => (
                  <div key={l.name} className="flex flex-col gap-1 rounded-2xl bg-card px-4 py-3.5">
                    <dt className="text-sm font-semibold">{l.name}</dt>
                    <dd className="text-sm leading-relaxed text-muted-foreground">{l.text}</dd>
                  </div>
                ))}
              </dl>
            </PageSection>

            <PageSection id="lexique" icon="book" title="Lexique" description="Tous les mots de l’app, par ordre alphabétique.">
              <dl className="overflow-hidden rounded-2xl bg-card">
                {terms.map((t) => (
                  <div key={t.term} id={termId(t.term)} className="grid scroll-mt-24 gap-1 border-b border-muted px-4 py-3.5 transition-colors last:border-b-0 md:grid-cols-[200px_1fr] md:gap-6">
                    <dt className="text-sm font-semibold">{t.term}</dt>
                    <dd className="text-sm leading-relaxed text-muted-foreground">{t.def}</dd>
                  </div>
                ))}
              </dl>
            </PageSection>

            <PageSection id="faq" icon="help" title="Questions fréquentes">
              <div className="flex flex-col gap-6">
                {FAQ_GROUPS.map((g) => (
                  <div key={g.id} className="flex flex-col gap-2">
                    <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{g.title}</h3>
                    <div className="overflow-hidden rounded-2xl bg-card">
                      {FAQ.filter((f) => f.group === g.id).map((f) => (
                        <details key={f.id} id={`faq-${f.id}`} className="group scroll-mt-24 border-b border-muted transition-colors last:border-b-0">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-medium transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden">
                            {f.q}
                            <span aria-hidden="true" className="text-lg leading-none text-muted-foreground transition-transform duration-200 group-open:rotate-90">›</span>
                          </summary>
                          <p className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                        </details>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </PageSection>

            <PageSection id="raccourcis" icon="keyboard" title="Raccourcis clavier" description="Pour aller plus vite dans la liste des sujets.">
              <dl className="grid gap-x-8 rounded-2xl bg-card px-5 py-2 sm:grid-cols-2">
                {SHORTCUTS.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-4 border-b border-muted py-2.5 text-sm last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                    <dt className="text-muted-foreground">{v}</dt>
                    <dd>
                      <kbd className="elev-1 rounded-md bg-background px-2 py-0.5 font-mono text-xs">{k}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </PageSection>

            <p className="pb-6 text-center text-[13px] text-muted-foreground">
              Tu ne trouves pas ta réponse ?{' '}
              {process.env.NEXT_PUBLIC_CONTACT_EMAIL && (
                <>
                  <a href={`mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL}`} className="font-medium text-primary hover:underline">Écris-nous</a>
                  {' · '}
                </>
              )}
              <Link href="/settings" className="font-medium text-primary hover:underline">Réglages</Link>
              {' · '}
              <Link href="/confidentialite" className="font-medium text-primary hover:underline">Confidentialité</Link>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
