'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Tv,
  ListChecks,
  MessageSquareWarning,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Separator } from '@/components/ui/separator';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Matrice', desc: 'Opportunites & MGI', icon: LayoutDashboard },
  { href: '/channels', label: 'Chaines', desc: 'YouTube surveillees', icon: Tv },
  { href: '/topics/review', label: 'Validation', desc: 'Sujets a valider', icon: ListChecks },
  { href: '/frustrations', label: 'Frustrations', desc: 'Besoins spectateurs', icon: MessageSquareWarning },
];

const ADMIN_ITEMS = [
  { href: '/admin/jobs', label: 'Jobs', icon: Settings },
];

function NavLink({
  href,
  label,
  desc,
  icon: Icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  desc?: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? `${label} — ${desc ?? ''}` : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
        active
          ? 'bg-sidebar-accent text-sidebar-primary shadow-[inset_2px_0_0_oklch(0.70_0.18_264)]'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground hover:translate-x-0.5'
      } ${collapsed ? 'justify-center px-0' : ''}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && (
        <div className="flex flex-col">
          <span>{label}</span>
          {desc && <span className="text-[10px] font-normal text-sidebar-foreground/40 leading-tight">{desc}</span>}
        </div>
      )}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside
      className={`flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300 sidebar-glow ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-14 shrink-0">
        <div
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground transition-shadow duration-300 hover:shadow-[0_0_20px_oklch(0.70_0.18_264_/_0.5)]"
          style={{ animation: 'float-fast 6s ease-in-out infinite' }}
        >
          <Zap className="w-4 h-4" />
        </div>
        {!collapsed && (
          <span className="text-lg font-bold tracking-tight">TubLyTI</span>
        )}
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            desc={item.desc}
            icon={item.icon}
            active={pathname.startsWith(item.href)}
            collapsed={collapsed}
          />
        ))}

        <Separator className="bg-sidebar-border my-3" />

        <p className={`px-3 text-[10px] uppercase tracking-wider text-sidebar-foreground/40 mb-1 ${collapsed ? 'sr-only' : ''}`}>
          Admin
        </p>
        {ADMIN_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={pathname.startsWith(item.href)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Footer */}
      <div className="px-2 pb-3 space-y-1">
        <Separator className="bg-sidebar-border mb-2" />
        <button
          onClick={handleLogout}
          title={collapsed ? 'Deconnexion' : undefined}
          className={`flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors cursor-pointer ${
            collapsed ? 'justify-center px-0' : ''
          }`}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Deconnexion</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-full rounded-lg px-3 py-1.5 text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-colors cursor-pointer"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
