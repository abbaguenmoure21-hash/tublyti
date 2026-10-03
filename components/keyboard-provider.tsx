'use client';

import { useState, useCallback } from 'react';
import { CommandPalette } from '@/components/command-palette';
import { ShortcutsHelpDialog } from '@/components/shortcuts-help-dialog';
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts';

export function KeyboardProvider({ isAdmin = false }: { isAdmin?: boolean }) {
  const [helpOpen, setHelpOpen] = useState(false);

  const onOpenSearch = useCallback(() => {
    // Dispatch ⌘K programmatically to let CommandPalette handle it
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true,
        bubbles: true,
      }),
    );
  }, []);

  const onOpenHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);

  useGlobalShortcuts({ onOpenSearch, onOpenHelp });

  return (
    <>
      <CommandPalette isAdmin={isAdmin} />
      <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
