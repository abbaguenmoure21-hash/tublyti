'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function MyChannelError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center">
      <AlertTriangle className="mb-4 h-8 w-8 text-destructive" aria-hidden="true" />
      <h2 className="mb-2 text-lg font-semibold">Impossible d’afficher ta chaîne</h2>
      <p className="mb-4 max-w-md text-sm text-muted-foreground">
        Les chiffres de ta chaîne n’ont pas pu être chargés. Vérifie ta connexion et réessaie.
      </p>
      <Button size="lg" onClick={reset}>Réessayer</Button>
    </div>
  );
}
