'use client';

import { useEffect, useState } from 'react';
import {
  Bell,
  BookOpen,
  CircleHelp,
  Compass,
  Gauge,
  LetterText,
  MessageSquareQuote,
  Palette,
  Rocket,
  Sparkles,
  TrendingUp,
  Tv,
  User,
  Keyboard,
  type LucideIcon,
} from 'lucide-react';

/** Icônes disponibles (les composants ne peuvent pas passer du serveur au client : on passe un nom). */
const ICONS: Record<string, LucideIcon> = {
  bell: Bell,
  book: BookOpen,
  help: CircleHelp,
  compass: Compass,
  gauge: Gauge,
  letters: LetterText,
  quote: MessageSquareQuote,
  palette: Palette,
  rocket: Rocket,
  sparkles: Sparkles,
  trend: TrendingUp,
  tv: Tv,
  user: User,
  keyboard: Keyboard,
};

export interface SectionNavItem {
  id: string;
  label: string;
  icon?: keyof typeof ICONS | string;
  /** Petit compteur ou pastille à droite (ex. « 2 à vérifier »). */
  badge?: string | null;
  badgeTone?: 'neutral' | 'warn';
}

/**
 * Sommaire collant d'une longue page, façon Réglages d'Apple :
 * colonne à gauche sur ordinateur, rangée défilante en haut sur téléphone.
 * La section visible est surlignée pendant le défilement.
 */
export function SectionNav({ items, label }: { items: SectionNavItem[]; label: string }) {
  const [active, setActive] = useState(items[0]?.id ?? '');

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => Boolean(e));
    if (!els.length) return;
    const visible = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        // La première section visible dans l'ordre de la page gagne.
        const first = items.find((i) => (visible.get(i.id) ?? 0) > 0);
        if (first) setActive(first.id);
      },
      { rootMargin: '-15% 0px -55% 0px', threshold: [0, 0.01, 0.25] },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [items]);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    setActive(id);
  };

  return (
    <nav aria-label={label} className="-mx-4 px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-col lg:overflow-visible lg:pb-0">
        {items.map((it) => {
          const Icon = it.icon ? ICONS[it.icon] : null;
          const on = active === it.id;
          return (
            <li key={it.id} className="shrink-0">
              <a
                href={`#${it.id}`}
                onClick={go(it.id)}
                aria-current={on ? 'true' : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-[14px] transition-colors ${
                  on ? 'elev-1 bg-card font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {Icon && (
                  <span className={`flex h-6 w-6 items-center justify-center rounded-md ${on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                )}
                <span className="flex-1">{it.label}</span>
                {it.badge && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                      it.badgeTone === 'warn' ? 'bg-[color-mix(in_oklch,var(--warning)_18%,transparent)] text-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {it.badge}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
