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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';
import { useTheme } from 'next-themes';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';

const NAV_ITEMS = [
  { href: '/today', label: 'Aujourd\u2019hui', icon: Sun },
  { href: '/dashboard', label: 'Matrice', icon: ScatterChart },
  { href: '/pipeline', label: 'Pipeline', icon: Columns3 },
  { href: '/frustrations', label: 'Frustrations', icon: MessageSquareWarning },
  { href: '/activity', label: 'Activité', icon: Activity },
  { href: '/topics/review', label: 'Validation', icon: ListChecks },
  { href: '/channels', label: 'Chaînes', icon: Tv },
];

const BOTTOM_NAV = [
  { href: '/settings', label: 'Réglages', icon: SlidersHorizontal },
  { href: '/admin/jobs', label: 'Jobs', icon: Settings },
];

const PAGE_TITLES: Record<string, string> = {
  '/today': 'Aujourd\u2019hui',
  '/': 'Aujourd\u2019hui',
  '/dashboard': 'Matrice',
  '/pipeline': 'Pipeline',
  '/frustrations': 'Frustrations',
  '/activity': 'Activité',
  '/topics/review': 'Validation',
  '/channels': 'Chaînes',
  '/settings': 'Réglages',
  '/admin/jobs': 'Jobs',
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
      className={`flex items-center gap-2.5 h-9 rounded-lg px-2.5 text-sm font-medium transition-colors duration-120 ${
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
      } ${collapsed ? 'justify-center px-0' : ''}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
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
}: {
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
  onLogout: () => void;
  onToggle?: () => void;
  showToggle: boolean;
}) {
  return (
    <>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 py-4 pb-5 shrink-0">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-bold text-[15px]">
          T
        </div>
        {!collapsed && (
          <span className="text-base font-semibold tracking-[-0.01em]">TubLyTI</span>
        )}
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
          {showToggle && (
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
          )}
        </div>
      </div>
    </>
  );
}

function getPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith('/topics/')) return 'Sujet';
  if (pathname.startsWith('/dashboard')) return 'Matrice';
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

      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-240 ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <SidebarContent
          pathname={pathname}
          collapsed={collapsed}
          onLogout={handleLogout}
          onToggle={toggleCollapsed}
          showToggle={true}
        />
      </aside>
    </>
  );
}
