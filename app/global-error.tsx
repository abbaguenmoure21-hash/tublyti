'use client';

import { useEffect } from 'react';
import './globals.css';

/**
 * Last-resort boundary: replaces the root layout when it crashes,
 * so it must render its own <html> and <body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] global error', error.digest ?? '', error.message);
  }, [error]);

  return (
    <html lang="fr">
      <body className="bg-background text-foreground antialiased">
        <main role="alert" className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
          <h1 className="mb-2 text-lg font-semibold">TubLyTI n’a pas pu s’afficher</h1>
          <p className="mb-4 max-w-md text-sm text-muted-foreground">
            Un souci est survenu de notre côté. Réessaie dans un instant.
          </p>
          <button
            type="button"
            onClick={reset}
            className="h-9 cursor-pointer rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}
