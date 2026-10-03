'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sun,
  ScatterChart,
  Columns3,
  MessageSquareWarning,
  ListChecks,
  Tv,
  SlidersHorizontal,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  Monitor,
  Moon,
  SunMedium,
  Activity,
  Bell,
  BookOpen,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';

const NAV_ITEMS = [
  { href: '/today', label: 'Aujourd\u2019hui', icon: Sun },
  { href: '/dashboard', label: 'Carte des sujets', icon: ScatterChart },
  { href: '/pipeline', label: 'Production', icon: Columns3 },
  { href: '/frustrations', label: 'Questions du public', icon: MessageSquareWarning },
  { href: '/activity', label: 'Concurrents', icon: Activity },
  { href: '/topics/review', label: 'Sujets à valider', icon: ListChecks },
  { href: '/channels', label: 'Chaînes suivies', icon: Tv },
];

const BOTTOM_NAV = [
  { href: '/guide', label: 'Guide d’utilisation', icon: BookOpen },
  { href: '/settings', label: 'Réglages', icon: SlidersHorizontal },
  { href: '/admin/jobs', label: 'Santé des données', icon: Settings },
];

const PAGE_TITLES: Record<string, string> = {
  '/today': 'Aujourd\u2019hui',
  '/': 'Aujourd\u2019hui',
  '/dashboard': 'Carte des sujets',
  '/pipeline': 'Production',
  '/frustrations': 'Questions du public',
  '/activity': 'Concurrents',
  '/topics/review': 'Sujets à valider',
  '/channels': 'Chaînes suivies',
  '/guide': 'Guide d’utilisation',
  '/settings': 'Réglages',
  '/admin/jobs': 'Santé des données',
};

const COOKIE_KEY = 'tublyti-sidebar';

function setCookie(value: string) {
  document.cookie = `${COOKIE_KEY}=${value};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`
        relative flex items-center gap-3 h-[42px] rounded-2xl px-3 text-[14px] font-medium
        transition-all duration-200 cursor-pointer
        ${active
          ? 'bg-white dark:bg-[#1C1C1E] text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.06)] border border-black/5 dark:border-white/10 font-semibold'
          : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
        }
        ${collapsed ? 'justify-center px-0' : ''}
      `}
    >
      {/* Active indicator bar - more subtle and modern */}
      {active && (
        <motion.div
          layoutId="sidebar-active-indicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary shadow-[0_0_8px_rgba(10,132,255,0.6)]"
          transition={{ type: 'spring', stiffness: 450, damping: 28, mass: 0.8 }}
        />
      )}
      <Icon className={`w-5 h-5 shrink-0 transition-colors ${active ? 'text-primary' : ''}`} />
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden whitespace-nowrap"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}

function NotificationBell({ collapsed, onClick }: { collapsed: boolean; onClick?: () => void }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res = await fetch('/api/alerts/unread');
        if (res.ok) {
          const data = await res.json();
          if (active) setCount(data.count ?? 0);
        }
      } catch {
        // ignore
      }
    }
    poll();
    const interval = setInterval(poll, 60_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <Link
      href="/settings?tab=alerts"
      onClick={onClick}
      title={collapsed ? `Alertes${count > 0 ? ` (${count})` : ''}` : undefined}
      className={`relative flex items-center gap-2.5 h-9 rounded-lg px-2.5 text-sm font-medium transition-colors duration-120 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground ${
        collapsed ? 'justify-center px-0' : ''
      }`}
    >
      <div className="relative">
        <Bell className="w-4 h-4 shrink-0" />
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </div>
      {!collapsed && <span>Alertes</span>}
    </Link>
  );
}

function ThemeSelector({ collapsed }: { collapsed: boolean }) {
  const { theme, setTheme } = useTheme();

  if (collapsed) {
    return (
      <button
        onClick={() => {
          const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
          setTheme(next);
        }}
        title="Changer le thème"
        className="flex items-center justify-center w-full h-9 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors cursor-pointer"
      >
        {theme === 'dark' ? (
          <Moon className="w-4 h-4" />
        ) : theme === 'light' ? (
          <SunMedium className="w-4 h-4" />
        ) : (
          <Monitor className="w-4 h-4" />
        )}
      </button>
    );
  }

  const options = [
    { value: 'light', label: 'Clair', icon: SunMedium },
    { value: 'dark', label: 'Sombre', icon: Moon },
    { value: 'system', label: 'Système', icon: Monitor },
  ] as const;

  return (
    <div className="flex p-[3px] gap-0.5 bg-sidebar-accent/40 rounded-lg">
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            className={`flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md text-[12px] font-medium transition-colors cursor-pointer ${
              active
                ? 'bg-card text-sidebar-foreground shadow-[0_1px_2px_rgba(20,24,34,0.08)]'
                : 'text-sidebar-foreground/50 hover:text-sidebar-foreground/80'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SidebarContent({
  pathname,
  collapsed,
  onNavigate,
  onLogout,
  onToggle,
  showToggle,
  isMobile,
}: {
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
  onLogout: () => void;
  onToggle?: () => void;
  showToggle: boolean;
  isMobile?: boolean;
}) {
  return (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-6 pb-6 shrink-0">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-blue-600 text-primary-foreground font-bold text-[17px] shadow-[0_2px_10px_rgba(10,132,255,0.4)]">
          T
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              className="text-[18px] font-bold tracking-[-0.03em] text-foreground"
            >
              TubLyTI
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={
              item.href === '/today'
                ? pathname === '/today' || pathname === '/'
                : pathname.startsWith(item.href)
            }
            collapsed={collapsed}
            onClick={onNavigate}
          />
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="px-3 pb-3 space-y-1">
        {isMobile && (
          <>
            <NotificationBell collapsed={collapsed} onClick={onNavigate} />
            {BOTTOM_NAV.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={pathname.startsWith(item.href)}
                collapsed={collapsed}
                onClick={onNavigate}
              />
            ))}

            <div className="border-t border-sidebar-border mt-2 pt-2 space-y-1">
              <ThemeSelector collapsed={collapsed} />
              <button
                onClick={onLogout}
                title={collapsed ? 'Déconnexion' : undefined}
                className={`flex items-center gap-2.5 w-full h-9 rounded-lg px-2.5 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors cursor-pointer ${
                  collapsed ? 'justify-center px-0' : ''
                }`}
              >
                <LogOut className="w-4 h-4 shrink-0" />
                {!collapsed && <span>Déconnexion</span>}
              </button>
            </div>
          </>
        )}

        {showToggle && (
          <div className="border-t border-sidebar-border mt-2 pt-2 space-y-1">
            <button
              onClick={onToggle}
              className="flex items-center justify-center w-full rounded-lg px-2.5 py-1.5 text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors cursor-pointer"
            >
              {collapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith('/topics/')) return 'Sujet';
  if (pathname.startsWith('/dashboard')) return 'Carte des sujets';
  return 'TubLyTI';
}

export function AppSidebar({ defaultCollapsed = false }: { defaultCollapsed?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [sheetOpen, setSheetOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      setCookie(next ? 'collapsed' : 'expanded');
      return next;
    });
  }, []);

  const handleLogout = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }, [router]);

  const pageTitle = getPageTitle(pathname);

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-2.5 h-14 px-3 bg-sidebar border-b border-sidebar-border">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            className="w-10 h-10 flex items-center justify-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
            aria-label="Ouvrir le menu"
          >
            <Menu className="w-5 h-5" />
          </SheetTrigger>
          <SheetContent
            side="left"
            showCloseButton={false}
            className="w-64 p-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border"
          >
            <SheetTitle className="sr-only">Menu de navigation</SheetTitle>
            <SidebarContent
              pathname={pathname}
              collapsed={false}
              onNavigate={() => setSheetOpen(false)}
              onLogout={handleLogout}
              showToggle={false}
              isMobile={true}
            />
          </SheetContent>
        </Sheet>
        <div className="flex items-center justify-center w-[26px] h-[26px] rounded-[7px] bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm">
          T
        </div>
        <span className="text-base font-semibold flex-1">{pageTitle}</span>
        <NotificationBell collapsed={true} />
      </div>

      {/* Mobile spacer */}
      <div className="md:hidden h-14 shrink-0" />

      {/* Desktop sidebar — floating glass panel, fixed on scroll */}
      <motion.aside
        animate={{ width: collapsed ? 80 : 260 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="hidden md:flex flex-col sticky top-4 h-[calc(100vh-32px)] ml-4 rounded-[24px] bg-white/60 dark:bg-[#08090C]/60 border border-[--glass-border] shadow-lg backdrop-blur-2xl overflow-y-auto overflow-x-hidden hide-scrollbar z-40 shrink-0"
      >
        <SidebarContent
          pathname={pathname}
          collapsed={collapsed}
          onLogout={handleLogout}
          onToggle={toggleCollapsed}
          showToggle={true}
          isMobile={false}
        />
      </motion.aside>
    </>
  );
}
