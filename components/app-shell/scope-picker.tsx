'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setScope } from '@/lib/actions/scope';

/** Choix d'une chaîne quand une page ne peut montrer qu'une chaîne à la fois (Résultats). */
export function ScopePicker({ channels }: { channels: { key: string; label: string; color: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-20 text-center">
      <h1 className="text-[28px] font-semibold tracking-[-0.02em]">De quelle chaîne veux-tu les résultats ?</h1>
      <p className="text-[15px] text-muted-foreground">Les résultats se lisent chaîne par chaîne. Ton choix s’applique aussi aux autres pages, via « Afficher ».</p>
      <ul className="mt-2 flex w-full flex-col gap-2">
        {channels.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await setScope(c.key);
                  router.refresh();
                })
              }
              className="elev-1 flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3.5 text-left text-[15px] font-medium transition-shadow hover:elev-2"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} aria-hidden="true" />
              {c.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
