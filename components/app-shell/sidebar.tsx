'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useOptimistic, useState, useTransition } from 'react';
import { useTheme } from 'next-themes';
import { LogOut, Moon, Sun, Monitor, Search, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { setScope } from '@/lib/actions/scope';
import type { ScopeNiche } from '@/lib/scope';
import { SPACES, SECONDARY, ADMIN_SPACE, SIDEBAR_COOKIE, isActive } from './nav-config';
import { ChannelSwitcher } from './channel-switcher';

interface SidebarProps {
  niches: ScopeNiche[];
  scope: string | null;
  badges: { sujets?: number; videos?: number };
  dataFresh: boolean;
  userLabel: string;
  /** Affiche l'accès à la console d'administration. */
  isAdmin?: boolean;
  /** Barre réduite au chargement (cookie lu côté serveur : pas de saut à l'affichage). */
  initialCollapsed?: boolean;
}

/**
 * Barre latérale façon macOS : fond translucide, 3 espaces, sélecteur de chaîne compact.
 * Rétractable (bouton ou ⌘B / Ctrl+B) ; le choix est gardé dans un cookie.
 */
export function Sidebar({ niches, scope, badges, dataFresh, userLabel, isAdmin = false, initialCollapsed = false }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimisticScope, setOptimisticScope] = useOptimistic(scope ?? 'all');
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const { theme, setTheme } = useTheme();

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'open'}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  // Raccourci ⌘B / Ctrl+B (ignoré pendant la saisie).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'b' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      toggle();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

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
  const c = collapsed;

  return (
    <aside
      aria-label="Barre latérale"
      data-collapsed={c || undefined}
      className={`elev-2 sticky top-2 my-2 ml-2 hidden h-[calc(100vh-16px)] shrink-0 flex-col gap-1 overflow-y-auto overflow-x-hidden rounded-panel bg-card/75 py-4 backdrop-blur-2xl backdrop-saturate-150 transition-[width,padding] duration-200 ease-standard motion-reduce:transition-none md:flex ${
        c ? 'w-[68px] items-center px-2' : 'w-[248px] px-3'
      }`}
    >
      {/* En-tête : logo + bouton pour réduire */}
      <div className={`mb-3 flex items-center ${c ? 'flex-col gap-2' : 'gap-2'}`}>
        <Link href="/sujets" className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1 text-foreground" title={c ? 'TubLyTI' : undefined}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-primary text-[15px] font-bold text-primary-foreground">T</span>
          {!c && <span className="text-base font-semibold tracking-[-0.01em]">TubLyTI</span>}
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={c ? 'Agrandir la barre latérale' : 'Réduire la barre latérale'}
          aria-expanded={!c}
          title={`${c ? 'Agrandir' : 'Réduire'} la barre (⌘B)`}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${c ? '' : 'ml-auto'}`}
        >
          {c ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />}
        </button>
      </div>

      <button
        type="button"
        onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
        aria-label="Rechercher (⌘K)"
        title={c ? 'Rechercher (⌘K)' : undefined}
        className={`well mb-3 flex h-9 items-center gap-2 rounded-[10px] bg-muted/70 text-[13px] text-muted-foreground transition-colors hover:text-foreground ${
          c ? 'w-10 justify-center' : 'px-2.5'
        }`}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!c && (
          <>
            Rechercher
            <kbd className="ml-auto rounded border border-border bg-card px-1.5 font-mono text-[11px]">⌘K</kbd>
          </>
        )}
      </button>

      {niches.length > 0 && (
        <div className={`mb-4 ${c ? '' : 'w-full'}`}>
          <ChannelSwitcher
            compact={c}
            value={optimisticScope}
            onChange={chooseScope}
            items={niches.map((n) => ({ key: n.key, label: n.label, color: n.color, verified: n.verified }))}
          />
        </div>
      )}

      <nav aria-label="Navigation principale" className={`flex flex-col gap-0.5 ${c ? 'items-center' : ''}`}>
        {SPACES.map((s) => {
          const active = isActive(pathname, s.match);
          const count = s.key === 'sujets' ? badges.sujets : s.key === 'videos' ? badges.videos : undefined;
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={active ? 'page' : undefined}
              aria-label={c ? s.label : undefined}
              title={c ? s.label : undefined}
              className={`relative flex h-10 items-center gap-2.5 rounded-[10px] text-sm font-medium transition-colors ${c ? 'w-10 justify-center' : 'px-2.5'} ${
                active ? 'elev-1 bg-primary-soft text-primary-ink' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <s.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              {!c && s.label}
              {count ? (
                c ? (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" aria-label={`${count}`} />
                ) : (
                  <span
                    className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                      active ? 'bg-card text-primary-ink' : 'bg-primary-soft text-primary-ink'
                    }`}
                    aria-label={s.key === 'sujets' ? `${count} nouveaux sujets` : `${count} vidéos en cours`}
                  >
                    {count}
                  </span>
                )
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {(isAdmin ? [ADMIN_SPACE, ...SECONDARY] : SECONDARY).map((s) => {
        const active = isActive(pathname, s.match);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? 'page' : undefined}
            aria-label={c ? s.label : undefined}
            title={c ? s.label : undefined}
            className={`flex h-9 shrink-0 items-center gap-2.5 rounded-[10px] text-sm font-medium transition-colors ${c ? 'w-10 justify-center' : 'px-2.5'} ${
              active ? 'bg-primary-soft text-primary-ink' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <s.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!c && s.label}
          </Link>
        );
      })}

      <div className={`mt-2 flex shrink-0 border-t border-border pt-3 ${c ? 'w-full flex-col items-center gap-1' : 'items-center gap-1'}`}>
        <span
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-primary-ink"
          title={c ? `${userLabel} · ${dataFresh ? 'Données à jour' : 'Données en retard'}` : undefined}
          aria-hidden={!c}
        >
          {userLabel.slice(0, 2).toUpperCase()}
          {c && <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-card ${dataFresh ? 'bg-phase-2' : 'bg-warning'}`} />}
        </span>
        {!c && (
          <span className="ml-1.5 flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium">{userLabel}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={dataFresh ? 'Données mises à jour cette nuit' : 'La dernière mise à jour a plus de 36 heures'}>
              <span className={`h-1.5 w-1.5 rounded-full ${dataFresh ? 'bg-phase-2' : 'bg-warning'}`} aria-hidden="true" />
              {dataFresh ? 'Données à jour' : 'Données en retard'}
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={() => setTheme(nextTheme)}
          aria-label={`${themeLabel}. Changer de thème`}
          title={themeLabel}
          className={`flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground ${c ? '' : 'ml-auto'}`}
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
