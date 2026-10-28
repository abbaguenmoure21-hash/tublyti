'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SPACES, ADMIN_SPACE, SECTION_TABS, isActive } from './nav-config';

/**
 * Onglets de l'espace courant (Sujets, Mes vidéos, Veille, Console), affichés en haut du contenu.
 * Style « contrôle segmenté » d'Apple : une seule sélection, fond qui glisse sous l'onglet actif.
 */
export function SectionTabs() {
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
              href={t.href}
              aria-current={on ? 'page' : undefined}
              className={`flex h-11 md:h-8 shrink-0 items-center rounded-[9px] px-3.5 text-[13px] transition-all duration-150 ${
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
