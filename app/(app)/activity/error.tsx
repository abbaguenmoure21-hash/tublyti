'use client';

import { AlertTriangle } from 'lucide-react';

/** Shared by /activity and /activity/changes: a loading failure is never shown as "nothing new". */
export default function ActivityError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-2 p-8 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
      <h2 className="text-lg font-semibold">Impossible de charger la veille</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Les données n’ont pas pu être lues. Ce n’est pas un manque de nouveautés : réessaie dans un instant.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 h-10 cursor-pointer rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Réessayer
      </button>
    </div>
  );
}
