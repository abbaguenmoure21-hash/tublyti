'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { sendDigestNow } from '@/lib/actions/digest';

/** Envoie tout de suite le résumé du dimanche à l'adresse du compte. */
export function DigestButton({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Chaque dimanche, TubLyTI t’envoie à <strong className="text-foreground">{email}</strong> les meilleurs sujets de tes chaînes, ceux qui viennent de passer à « C’est le moment », les résultats de tes vidéos publiées et tes alertes de la semaine.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await sendDigestNow();
            if ('error' in res && res.error) toast.error(res.error);
            else toast.success('Résumé envoyé', { description: email });
          })
        }
        className="inline-flex h-10 items-center gap-2 self-start rounded-[10px] border border-border bg-card px-4 text-sm font-medium hover:bg-muted disabled:opacity-60"
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {pending ? 'Envoi…' : 'M’envoyer le résumé maintenant'}
      </button>
    </div>
  );
}
