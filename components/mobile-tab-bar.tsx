'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
import { SPACES, isActive } from '@/components/app-shell/nav-config';

const TABS = [
  ...SPACES.map((s) => ({ href: s.href, label: s.label, icon: s.icon, match: s.match })),
  { href: '/settings', label: 'Réglages', icon: SlidersHorizontal, match: ['/settings', '/profile', '/admin', '/guide'] },
];

/** Barre d'onglets du bas sur mobile (4 entrées, cibles de 64 px de haut). */
export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="elev-3 fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 grid h-16 grid-cols-4 rounded-[24px] bg-card/80 backdrop-blur-2xl backdrop-saturate-150 md:hidden"
    >
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.match);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-[3px] text-[11px] font-medium transition-colors ${
              active ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
