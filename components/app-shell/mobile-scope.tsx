'use client';

import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setScope } from '@/lib/actions/scope';

/** Sélecteur « Afficher » pour mobile (la barre latérale n'existe pas sur petit écran). */
export function MobileScope({
  channels,
  scope,
}: {
  channels: { key: string; label: string; verified: boolean }[];
  scope: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [value, setValue] = useOptimistic(scope ?? 'all');
  if (!channels.length) return null;
  return (
    <label className="flex items-center gap-2 px-4 pt-4 text-[13px] font-medium text-muted-foreground md:hidden">
      Afficher
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          startTransition(async () => {
            setValue(v);
            await setScope(v);
            router.refresh();
          });
        }}
        className="well h-9 min-w-0 flex-1 rounded-[10px] bg-muted px-2 text-[15px] text-foreground"
      >
        <option value="all">Toutes mes chaînes</option>
        {channels.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
            {c.verified ? '' : ' (à vérifier)'}
          </option>
        ))}
      </select>
    </label>
  );
}
