'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PipelineError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
      <AlertTriangle className="mb-4 h-8 w-8 text-destructive" aria-hidden="true" />
      <h2 className="mb-2 text-lg font-semibold">Impossible d’afficher tes vidéos</h2>
      <p className="mb-4 max-w-md text-sm text-muted-foreground">
        Le tableau n’a pas pu être chargé. Vérifie ta connexion et réessaie.
      </p>
      <Button size="lg" onClick={reset}>Réessayer</Button>
    </div>
  );
}
