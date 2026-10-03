'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { setUserRole } from '@/lib/actions/admin-users';

export function RoleSelect({ userId, role, self }: { userId: string; role: 'client' | 'admin'; self: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <select
      aria-label="Rôle"
      value={role}
      disabled={pending || self}
      onChange={(e) =>
        startTransition(async () => {
          const res = await setUserRole(userId, e.target.value as 'client' | 'admin');
          if ('error' in res && res.error) toast.error(res.error);
          else toast.success('Rôle mis à jour');
          router.refresh();
        })
      }
      className="h-8 rounded-md border border-input bg-card px-2 text-[13px] disabled:opacity-60"
    >
      <option value="client">Client</option>
      <option value="admin">Admin</option>
    </select>
  );
}
