'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { updateDisplayName } from '@/lib/actions/compte';

export function ProfileForm({ displayName, email }: { displayName: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateDisplayName(name);
      if ('error' in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success('Nom enregistré');
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Nom affiché
        <input
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          className="h-10 rounded-[10px] border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <p className="text-sm text-muted-foreground">Adresse de connexion : {email}</p>
      <button
        type="submit"
        disabled={pending || name.trim() === displayName}
        className="inline-flex h-10 items-center self-start rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        Enregistrer
      </button>
    </form>
  );
}
