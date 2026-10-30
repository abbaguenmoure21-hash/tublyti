'use client';

import type { CSSProperties } from 'react';
import { useTheme } from 'next-themes';
import { Toaster } from 'sonner';

/**
 * App notifications (DESIGN.md: bottom right). Follows the current theme and,
 * on mobile, sits above the bottom tab bar (64 px + 12 px gap + safe area).
 */
export function AppToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      offset={24}
      mobileOffset={{ bottom: 'calc(64px + 24px + env(safe-area-inset-bottom))' }}
      toastOptions={{ className: 'rounded-xl elev-3' }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
    />
  );
}
