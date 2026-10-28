'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Console d'admin : une lecture qui échoue affiche une vraie erreur, jamais un faux « 0 » ou un état vide. */
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 md:px-8 md:py-8">
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-4">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold text-destructive">Impossible de lire ces données pour le moment</p>
            <p className="text-sm text-muted-foreground">La base n’a pas répondu. Les chiffres ne sont pas à zéro : ils n’ont simplement pas pu être chargés.</p>
          </div>
          <Button variant="outline" size="sm" className="w-fit" onClick={() => reset()}>
            Réessayer
          </Button>
        </div>
      </div>
    </div>
  );
}
