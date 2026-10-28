'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Error state shared by route-level error.tsx files: a human sentence, never the technical message,
 * and a « Réessayer » button that re-renders the segment.
 */
export function PageError({
  title,
  message = 'Vérifie ta connexion puis réessaie. Si ça continue, reviens dans quelques minutes.',
  error,
  reset,
}: {
  title: string;
  message?: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Technical detail stays in the console / server logs.
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col px-4 pb-10 pt-5 md:px-8">
      <div role="alert" className="flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-16 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-1 inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}
