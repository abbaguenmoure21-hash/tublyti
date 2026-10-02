'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { 
  Bell, 
  SunMedium, 
  Moon, 
  Monitor,
  User,
  Shield,
  SlidersHorizontal,
  LogOut
} from 'lucide-react';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

function MiniQuota({ label, percent, color }: { label: string; percent: number; color: string }) {
  const r = 14;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(percent, 100) / 100) * circ;

  return (
    <div className="flex items-center gap-2" title={`${label}: ${percent}%`}>
      <svg width={36} height={36} viewBox="0 0 36 36" className="-rotate-90">
        <circle cx={18} cy={18} r={r} fill="none" stroke="var(--bg-surface-2)" strokeWidth={3} />
        <motion.circle
          cx={18} cy={18} r={r} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="flex flex-col leading-tight hidden xl:flex">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[11px] font-semibold text-mono-metric tabular-nums" style={{ color }}>
          {percent}%
        </span>
      </div>
    </div>
  );
}

function NotificationBell() {
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
      title="Alertes"
      className="relative flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
    >
      <Bell className="w-4 h-4" />
      {count > 0 && (
        <span className="absolute top-1.5 right-1.5 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-destructive text-white text-[9px] font-bold leading-none">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <div className="w-9 h-9" />;

  return (
    <button
      onClick={() => {
        const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
        setTheme(next);
      }}
      title="Changer le thème"
      className="flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
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

export function TopNav() {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="hidden md:flex items-center gap-2 bg-white/80 dark:bg-[#1C1C1E]/80 backdrop-blur-xl border border-[--glass-border] rounded-full px-2 py-1.5 shadow-sm">
      
      {/* Quotas - hide on smaller screens */}
      <div className="hidden md:flex items-center gap-3 pr-4 border-r border-[--glass-border]">
        <MiniQuota label="Quota YT" percent={24} color="#30D158" />
        <MiniQuota label="Claude" percent={12} color="#0A84FF" />
      </div>

      <div className="flex items-center gap-1">
        <NotificationBell />
        <Link href="/profile" title="Mon Profil" className="flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
          <User className="w-4 h-4" />
        </Link>
        <Link href="/admin" title="Espace Admin" className="flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
          <Shield className="w-4 h-4" />
        </Link>
        <Link href="/settings" title="Réglages" className="flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
          <SlidersHorizontal className="w-4 h-4" />
        </Link>
        
        <div className="w-[1px] h-4 bg-[--glass-border] mx-1" />
        
        <ThemeToggle />
        <button onClick={handleLogout} title="Déconnexion" className="flex items-center justify-center w-9 h-9 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
          <LogOut className="w-4 h-4" />
        </button>
      </div>

    </div>
  );
}
