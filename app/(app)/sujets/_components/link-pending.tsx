'use client';

import { useLinkStatus } from 'next/link';

/**
 * Immediate feedback while a row link navigates (the server re-renders the list + panel):
 * the row is tinted with a fixed accent bar (no looping animation), so a slow click never looks ignored.
 * Must be rendered inside a next/link <Link> with `relative` positioning.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-primary-soft/60">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" />
    </span>
  );
}
