'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sun, ScatterChart, Columns3, MoreHorizontal } from 'lucide-react';

const TABS = [
  { href: '/today', label: "Aujourd'hui", icon: Sun },
  { href: '/dashboard', label: 'Matrice', icon: ScatterChart },
  { href: '/pipeline', label: 'Pipeline', icon: Columns3 },
  { href: '/settings', label: 'Plus', icon: MoreHorizontal },
];

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 grid grid-cols-4 bg-card border-t border-border"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === '/today'
            ? pathname === '/today' || pathname === '/'
            : pathname.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-col items-center justify-center gap-[3px] text-[11px] font-medium transition-colors ${
              active ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <Icon className="w-5 h-5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
