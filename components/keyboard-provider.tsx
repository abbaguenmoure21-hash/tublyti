'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts';

// cmdk + palette (~36 KB gz) and the shortcuts dialog are not needed for the first paint:
// they are fetched on idle and mounted on first use.
const loadPalette = () => import('@/components/command-palette');
const CommandPalette = dynamic(() => loadPalette().then((m) => m.CommandPalette), { ssr: false });
const ShortcutsHelpDialog = dynamic(() => import('@/components/shortcuts-help-dialog').then((m) => m.ShortcutsHelpDialog), {
  ssr: false,
});

export function KeyboardProvider({ isAdmin = false }: { isAdmin?: boolean }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMounted, setHelpMounted] = useState(false);
  const [paletteMounted, setPaletteMounted] = useState(false);

  // Warm the palette chunk once the browser is idle, so the first ⌘K opens instantly.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => void loadPalette());
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => void loadPalette(), 2000);
    return () => clearTimeout(t);
  }, []);

  // Until the palette is mounted, catch ⌘K / Ctrl+K here (real keypress or the synthetic event
  // sent by the sidebar search button) and mount it already open. Once mounted, it handles ⌘K itself.
  useEffect(() => {
    if (paletteMounted) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteMounted(true);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [paletteMounted]);

  const onOpenSearch = useCallback(() => {
    // Dispatch ⌘K programmatically: caught above (first time) or by CommandPalette.
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true,
        bubbles: true,
      }),
    );
  }, []);

  const onOpenHelp = useCallback(() => {
    setHelpMounted(true);
    setHelpOpen(true);
  }, []);

  useGlobalShortcuts({ onOpenSearch, onOpenHelp });

  return (
    <>
      {paletteMounted && <CommandPalette isAdmin={isAdmin} defaultOpen />}
      {helpMounted && <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />}
    </>
  );
}
