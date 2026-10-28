'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { ShieldAlert } from 'lucide-react';
import { setScope } from '@/lib/actions/scope';

/** Pages dont le contenu dépend de la chaîne choisie dans « Afficher ». */
const DATA_PAGES = ['/sujets', '/dashboard', '/frustrations', '/topics', '/pipeline', '/my-channel', '/activity'];

/**
 * Si la chaîne choisie n'est pas encore vérifiée, ces pages n'affichent rien d'elle :
 * on demande d'abord de prouver qu'elle appartient au client.
 */
export function ScopeGate({
  pending,
  children,
}: {
  pending: { channelId: string; label: string } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [busy, startTransition] = useTransition();
  const gated = pending && DATA_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!gated) return <>{children}</>;

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-phase-1-soft text-phase-1-ink">
        <ShieldAlert className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{pending.label} est à vérifier</h1>
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        TubLyTI n’affiche les informations d’une chaîne qu’une fois qu’il est prouvé qu’elle t’appartient.
        La vérification prend une minute, avec Google ou avec un code dans la description de la chaîne.
      </p>
      <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
        <Link
          href={`/settings?verifier=${pending.channelId}#chaines`}
          className="inline-flex h-11 items-center rounded-[10px] bg-primary px-5 text-[15px] font-medium text-primary-foreground"
        >
          Vérifier la chaîne
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            startTransition(async () => {
              await setScope('all');
            })
          }
          className="inline-flex h-11 items-center rounded-[10px] px-4 text-[15px] font-medium text-primary hover:bg-muted"
        >
          Voir mes chaînes vérifiées
        </button>
      </div>
    </div>
  );
}
