'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  // cmdk input
  if (el.getAttribute('cmdk-input') !== null) return true;
  return false;
}

export function useGlobalShortcuts({
  onOpenSearch,
  onOpenHelp,
}: {
  onOpenSearch: () => void;
  onOpenHelp: () => void;
}) {
  const router = useRouter();
  const pendingPrefix = useRef<string | null>(null);
  const prefixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPrefix = useCallback(() => {
    pendingPrefix.current = null;
    if (prefixTimer.current) {
      clearTimeout(prefixTimer.current);
      prefixTimer.current = null;
    }
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore when meta/ctrl/alt is held (except for ⌘K handled by command palette)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Ignore when input is focused
      if (isInputFocused()) return;

      const key = e.key;

      // Handle "g" prefix for navigation sequences
      if (pendingPrefix.current === 'g') {
        clearPrefix();
        const routes: Record<string, string> = {
          t: '/sujets',
          m: '/dashboard',
          p: '/pipeline',
          f: '/frustrations',
        };
        if (routes[key]) {
          e.preventDefault();
          router.push(routes[key]);
          return;
        }
        // Unknown second key — ignore
        return;
      }

      // Start "g" prefix
      if (key === 'g') {
        e.preventDefault();
        pendingPrefix.current = 'g';
        // Auto-clear after 800ms
        prefixTimer.current = setTimeout(clearPrefix, 800);
        return;
      }

      // "/" opens search
      if (key === '/') {
        e.preventDefault();
        onOpenSearch();
        return;
      }

      // "?" opens help
      if (key === '?') {
        e.preventDefault();
        onOpenHelp();
        return;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearPrefix();
    };
  }, [router, onOpenSearch, onOpenHelp, clearPrefix]);
}
