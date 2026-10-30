'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { setUserRole } from '@/lib/actions/admin-users';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';

type Role = 'client' | 'admin';

export function RoleSelect({ userId, role, self, email }: { userId: string; role: Role; self: boolean; email: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmAdmin, setConfirmAdmin] = useState(false);

  function apply(next: Role, previous: Role, withUndo = true) {
    startTransition(async () => {
      const res = await setUserRole(userId, next);
      if ('error' in res && res.error) {
        toast.error(res.error);
      } else {
        toast.success(next === 'admin' ? `${email} a maintenant accès à la console` : `${email} est repassé client`, {
          action: withUndo ? { label: 'Annuler', onClick: () => apply(previous, next, false) } : undefined,
        });
      }
      setConfirmAdmin(false);
      router.refresh();
    });
  }

  return (
    <>
      <select
        aria-label={`Rôle de ${email}`}
        value={role}
        disabled={pending || self}
        onChange={(e) => {
          const next = e.target.value as Role;
          if (next === role) return;
          // Promotion gives access to every client's data: ask first.
          if (next === 'admin') setConfirmAdmin(true);
          else apply(next, role);
        }}
        className="well h-10 cursor-pointer rounded-[10px] bg-muted px-2 text-[13px] text-foreground disabled:opacity-60 md:h-8"
      >
        <option value="client">Client</option>
        <option value="admin">Admin</option>
      </select>
      <ConfirmDialog
        open={confirmAdmin}
        onOpenChange={setConfirmAdmin}
        title="Donner l’accès à la console ?"
        description={
          <p>
            <span className="font-medium text-foreground">{email}</span> verra tous les clients, tout le catalogue et les réglages de TubLyTI, et pourra les modifier.
          </p>
        }
        confirmLabel="Donner l’accès"
        onConfirm={() => apply('admin', role)}
        pending={pending}
      />
    </>
  );
}
