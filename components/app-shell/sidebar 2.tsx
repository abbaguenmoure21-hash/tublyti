'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';
import { useTheme } from 'next-themes';
import { LogOut, Moon, Sun, Monitor, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { setScope } from '@/lib/actions/scope';
import type { ScopeNiche } from '@/lib/scope';
import { SPACES, SECONDARY, isActive } from './nav-config';

interface SidebarProps {
  niches: ScopeNiche[];
  scope: string | null;
  badges: { sujets?: number; videos?: number };
  dataFresh: boolean;
  userLabel: string;
}

/**
 * Barre latérale façon macOS : fond translucide, 3 espaces, sélecteur de chaîne global.
 * Cibles de 36 px minimum (40 px pour les espaces), état actif en pastille.
 */
export function Sidebar({ niches, scope, badges, dataFresh, userLabel }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimisticScope, setOptimisticScope] = useOptimistic(scope ?? 'all');
  const { theme, setTheme } = useTheme();

  function chooseScope(value: string) {
    startTransition(async () => {
      setOptimisticScope(value);
      await setScope(value);
      router.refresh();
    });
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const themeLabel = theme === 'light' ? 'Thème clair' : theme === 'dark' ? 'Thème sombre' : 'Thème du système';

  return (
    <aside
      aria-label="Barre latérale"
      className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col gap-1 border-r border-border bg-card/80 px-3 py-4 backdrop-blur-xl md:flex"
    >
      <Link href="/sujets" className="mb-3 flex items-center gap-2.5 rounded-lg px-2 py-1 text-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-[15px] font-bold text-primary-foreground">T</span>
        <span className="text-base font-semibold tracking-[-0.01em]">TubLyTI</span>
      </Link>

      <button
        type="button"
        onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
        className="mb-3 flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        Rechercher
        <kbd className="ml-auto rounded border border-border bg-card px-1.5 font-mono text-[11px]">⌘K</kbd>
      </button>

      {niches.length > 0 && (
        <div role="radiogroup" aria-label="Chaîne affichée" className="mb-4 flex flex-col gap-0.5 rounded-xl border border-border p-1.5">
          <span className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Afficher</span>
          {[{ id: 'all', label: 'Toutes mes chaînes', color: 'var(--foreground)' }, ...niches].map((n) => {
            const checked = optimisticScope === n.id;
            return (
              <button
                key={n.id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => chooseScope(n.id)}
                className={`flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors ${
                  checked ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: n.color }} aria-hidden="true" />
                <span className="truncate">{n.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <nav aria-label="Navigation principale" className="flex flex-col gap-0.5">
        {SPACES.map((s) => {
          const active = isActive(pathname, s.match);
          const count = s.key === 'sujets' ? badges.sujets : s.key === 'videos' ? badges.videos : undefined;
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={active ? 'page' : undefined}
              className={`flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors ${
                active ? 'bg-primary-soft text-primary-ink' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <s.icon className="h-[18px] w-[18px]" aria-hidden="true" />
              {s.label}
              {count ? (
                <span
                  className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                    active ? 'bg-card text-primary-ink' : 'bg-primary-soft text-primary-ink'
                  }`}
                  aria-label={s.key === 'sujets' ? `${count} sujets à trier` : `${count} vidéos en cours`}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {SECONDARY.map((s) => {
        const active = isActive(pathname, s.match);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? 'page' : undefined}
            className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors ${
              active ? 'bg-primary-soft text-primary-ink' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <s.icon className="h-4 w-4" aria-hidden="true" />
            {s.label}
          </Link>
        );
      })}

      <div className="mt-2 flex items-center gap-1 border-t border-border pt-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-primary-ink" aria-hidden="true">
          {userLabel.slice(0, 2).toUpperCase()}
        </span>
        <span className="ml-1.5 flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium">{userLabel}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={dataFresh ? 'Données mises à jour cette nuit' : 'La dernière mise à jour a plus de 36 heures'}>
            <span className={`h-1.5 w-1.5 rounded-full ${dataFresh ? 'bg-phase-2' : 'bg-warning'}`} aria-hidden="true" />
            {dataFresh ? 'Données à jour' : 'Données en retard'}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setTheme(nextTheme)}
          aria-label={`${themeLabel}. Changer de thème`}
          title={themeLabel}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ThemeIcon className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={signOut}
          aria-label="Se déconnecter"
          title="Se déconnecter"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
