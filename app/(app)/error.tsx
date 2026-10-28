'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shared error boundary for every screen of the (app) group.
 * Pages may add their own error.tsx for a more specific message.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] page error', error.digest ?? '', error.message);
  }, [error]);

  return (
    <div role="alert" className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
      <AlertTriangle aria-hidden className="mb-4 size-8 text-destructive" />
      <h2 className="mb-2 text-lg font-semibold">Cette page n’a pas pu s’afficher</h2>
      <p className="mb-4 max-w-md text-sm text-muted-foreground">
        Un souci est survenu en chargeant tes données. Vérifie ta connexion et réessaie dans un instant.
      </p>
      <Button onClick={reset}>Réessayer</Button>
    </div>
  );
}
