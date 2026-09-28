'use client';

import { AlertTriangle } from 'lucide-react';

export default function TodayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
      <AlertTriangle className="w-8 h-8 text-destructive mb-4" />
      <h2 className="text-lg font-semibold mb-2">Impossible de charger la page</h2>
      <p className="text-sm text-muted-foreground max-w-md mb-4">
        Une erreur est survenue lors du chargement des données. Vérifie ta connexion et réessaie.
      </p>
      <button
        onClick={reset}
        className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
      >
        Réessayer
      </button>
    </div>
  );
}
