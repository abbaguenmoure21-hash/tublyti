'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { SPACES, ADMIN_SPACE, SECTION_TABS, isActive } from './nav-config';

/**
 * Onglets de l'espace courant (Sujets, Mes vidéos, Veille, Console), affichés en haut du contenu.
 * Style « contrôle segmenté » d'Apple : une seule sélection, fond qui glisse sous l'onglet actif.
 */
/** Liste ⇄ Carte keep the shared view (moment, open topic) — ERGONOMIE.md, règle 7. */
const SHARED_VIEW: Record<string, string[]> = { '/sujets': ['moment', 'sujet'], '/dashboard': ['moment', 'sujet'] };

function withSharedView(href: string, current: Pick<URLSearchParams, 'get'>): string {
  const keys = SHARED_VIEW[href];
  if (!keys) return href;
  const next = new URLSearchParams();
  for (const k of keys) {
    const v = current.get(k);
    // Only values both views understand (a single moment, or « tous »).
    if (v && (k !== 'moment' || /^([0-3]|tous)$/.test(v))) next.set(k, v);
  }
  const qs = next.toString();
  return qs ? `${href}?${qs}` : href;
}

function TabsWithSearch() {
  return <Tabs searchParams={useSearchParams()} />;
}

/** Suspense keeps static pages prerenderable (useSearchParams). */
export function SectionTabs() {
  return (
    <Suspense fallback={<Tabs searchParams={null} />}>
      <TabsWithSearch />
    </Suspense>
  );
}

function Tabs({ searchParams }: { searchParams: Pick<URLSearchParams, 'get'> | null }) {
  const pathname = usePathname();
  const space = [...SPACES, ADMIN_SPACE].find((s) => isActive(pathname, s.match));
  if (!space) return null;
  const tabs = SECTION_TABS[space.key];
  if (tabs.length < 2) return null;
  // Onglet actif = correspondance la plus longue (ex. /channels/candidates avant /channels).
  const active = [...tabs]
    .filter((t) => isActive(pathname, t.match))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!active) return null;

  return (
    <nav aria-label={`Sections de ${space.label}`} className="px-4 pt-4 md:px-8 md:pt-6">
      <div className="well inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[12px] bg-muted p-[3px]">
        {tabs.map((t) => {
          const on = t.href === active.href;
          return (
            <Link
              key={t.href}
              href={SHARED_VIEW[pathname] && searchParams ? withSharedView(t.href, searchParams) : t.href}
              aria-current={on ? 'page' : undefined}
              className={`flex h-8 shrink-0 items-center rounded-[9px] px-3.5 text-[13px] transition-colors duration-150 ${
                on ? 'elev-1 bg-card font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
