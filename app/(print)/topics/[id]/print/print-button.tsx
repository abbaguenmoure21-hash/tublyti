'use client';

import { Printer } from 'lucide-react';

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print fixed right-4 top-4 z-50 inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      Imprimer ou enregistrer en PDF
    </button>
  );
}
