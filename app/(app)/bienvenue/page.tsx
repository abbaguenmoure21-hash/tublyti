import type { Metadata } from 'next';
import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { loadMyChannels } from '@/lib/my-channels';
import { googleEnabled } from '@/lib/youtube/google-oauth';
import { readGoogleChannels } from '@/lib/actions/compte';
import { requireUser } from '@/lib/auth/session';
import { nicheColor, listScopeNiches } from '@/lib/scope';
import { Check } from 'lucide-react';
import { MyChannels } from '../settings/_client/my-channels';
import { FollowedNiches } from '../settings/_client/followed-niches';

export const metadata: Metadata = { title: 'Bienvenue' };

const STEPS = [
  { n: 1, title: 'Ajoute et vérifie ta chaîne', text: 'Colle son lien, choisis sa thématique, puis prouve qu’elle est à toi (1 à 3 minutes).' },
  { n: 2, title: 'Choisis un sujet', text: 'Commence par ceux marqués « C’est le moment ».' },
  { n: 3, title: 'Crée ta vidéo', text: 'Elle rejoint « Mes vidéos » pour suivre sa production.' },
];

type StepState = 'todo' | 'current' | 'progress' | 'done';
const STATE_LABEL: Record<StepState, string> = { todo: 'À faire', current: 'À faire maintenant', progress: 'En cours', done: 'Fait' };

/** Premier lancement d'un client : ajouter sa chaîne, ou suivre une thématique sans chaîne. */
export default async function BienvenuePage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const googleStatus = (await searchParams).google ?? null;
  const user = await requireUser();
  const db = createServiceClient();
  const [existing, nichesRes, followedRes] = await Promise.all([
    listScopeNiches(db, user.id),
    db.from('niches').select('id, name, category').eq('status', 'active').order('name'),
    db.from('user_niches').select('niche_id').eq('user_id', user.id),
  ]);
  const followed = ((followedRes.data ?? []) as { niche_id: string }[]).map((f) => f.niche_id);
  const catalogue = ((nichesRes.data ?? []) as { id: string; name: string; category: string | null }[]).map((n) => ({
    id: n.id,
    name: n.name,
    color: nicheColor(n.category),
  }));
  const nicheName = new Map(catalogue.map((n) => [n.id, n.name]));
  const channels = await loadMyChannels(db, user.id, nicheName);
  const ready = existing.length > 0;
  const hasVerified = channels.some((c) => c.status !== 'pending');
  const hasPending = channels.some((c) => c.status === 'pending');
  const stepState: Record<number, StepState> = {
    1: hasVerified ? 'done' : hasPending ? 'progress' : ready ? 'todo' : 'current',
    2: ready ? 'current' : 'todo',
    3: 'todo',
  };

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-4 py-10 md:py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <span className="elev-2 flex h-14 w-14 items-center justify-center rounded-[16px] bg-primary text-2xl font-bold text-primary-foreground">T</span>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Bienvenue, {user.displayName}</h1>
        <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
          TubLyTI repère les sujets que ton public réclame avant que tout le monde ne s’en empare. Quelques minutes de réglage, et ta liste est prête.
        </p>
      </header>

      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => {
          const state = stepState[s.n];
          return (
            <li
              key={s.n}
              aria-current={state === 'current' || state === 'progress' ? 'step' : undefined}
              className={`flex flex-col gap-1.5 rounded-2xl bg-card p-4 ${state === 'current' || state === 'progress' ? 'ring-2 ring-primary/40' : ''}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-ink">
                  {state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : s.n}
                </span>
                <span className="text-[12px] text-muted-foreground">{STATE_LABEL[state]}</span>
              </span>
              <span className="text-[15px] font-semibold">{s.title}</span>
              <span className="text-[13px] leading-snug text-muted-foreground">{s.text}</span>
            </li>
          );
        })}
      </ol>

      <section aria-labelledby="ajout" className="flex flex-col gap-3">
        <h2 id="ajout" className="text-lg font-semibold">{ready ? 'Tes chaînes' : 'Ajoute ta chaîne'}</h2>
        {hasPending && !hasVerified && (
          <p role="status" className="text-sm text-muted-foreground">
            Dernière étape : vérifie ta chaîne pour voir tes sujets. Clique sur « À vérifier ».
          </p>
        )}
        <MyChannels channels={channels} catalogue={catalogue} googleEnabled={googleEnabled()} googleChannels={await readGoogleChannels()} googleStatus={googleStatus} returnTo="bienvenue" />
      </section>

      <section aria-labelledby="explorer" className="flex flex-col gap-3">
        <h2 id="explorer" className="text-lg font-semibold">Pas encore de chaîne ?</h2>
        <p className="-mt-1 text-sm text-muted-foreground">
          Choisis les thématiques à explorer : tu verras leurs sujets avant de te lancer.
        </p>
        <FollowedNiches catalogue={catalogue} followed={followed} withChannel={channels.map((c) => c.nicheId)} />
      </section>

      {ready && (
        <Link
          href="/sujets"
          className="inline-flex h-12 items-center justify-center rounded-[12px] bg-primary text-[15px] font-medium text-primary-foreground"
        >
          Voir mes sujets
        </Link>
      )}

      <p className="text-center text-[13px] text-muted-foreground">
        Une question ? <Link href="/guide" className="font-medium text-primary hover:underline">Ouvre l’aide</Link>.
      </p>
    </div>
  );
}
