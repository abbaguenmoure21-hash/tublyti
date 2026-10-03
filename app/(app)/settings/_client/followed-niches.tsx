'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { followNiche, unfollowNiche } from '@/lib/actions/compte';

interface Niche { id: string; name: string; color: string }

export function FollowedNiches({ catalogue, followed, withChannel }: { catalogue: Niche[]; followed: string[]; withChannel: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const on = new Set(followed);
  const owned = new Set(withChannel);
  const list = catalogue.filter((n) => !owned.has(n.id));

  function toggle(n: Niche) {
    startTransition(async () => {
      const res = on.has(n.id) ? await unfollowNiche(n.id) : await followNiche(n.id);
      if ('error' in res && res.error) toast.error(res.error);
      router.refresh();
    });
  }

  if (!list.length) return <p className="text-sm text-muted-foreground">Tu as une chaîne sur chaque thématique disponible.</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {list.map((n) => {
        const active = on.has(n.id);
        return (
          <button
            key={n.id}
            type="button"
            aria-pressed={active}
            disabled={pending}
            onClick={() => toggle(n)}
            className={`flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
              active ? 'bg-foreground text-background' : 'bg-card ring-1 ring-inset ring-border hover:bg-muted'
            }`}
          >
            {active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <span className="h-2 w-2 rounded-full" style={{ background: n.color }} aria-hidden="true" />}
            {n.name}
          </button>
        );
      })}
    </div>
  );
}
