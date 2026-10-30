'use client';

import Link, { useLinkStatus } from 'next/link';
import { Loader2 } from 'lucide-react';
// Type-only import: lib/youtube/analytics pulls server code (token decryption).
import type { Period } from '@/lib/youtube/analytics';

/** Shows a spinner on the clicked tab while the new period loads (same route: loading.tsx does not show). */
function PendingMark() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <>
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      <span className="sr-only">Chargement…</span>
    </>
  );
}

export function PeriodTabs({ period, periods }: { period: Period; periods: readonly { key: string; label: string }[] }) {
  return (
    <nav aria-label="Période" className="well inline-flex rounded-[10px] bg-background p-0.5">
      {periods.map((p) => (
        <Link
          key={p.key}
          href={`/my-channel?periode=${p.key}`}
          scroll={false}
          aria-current={p.key === period ? 'page' : undefined}
          className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors ${
            p.key === period ? 'elev-1 bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {p.label}
          <PendingMark />
        </Link>
      ))}
    </nav>
  );
}
