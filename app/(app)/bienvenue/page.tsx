import type { Metadata } from 'next';
import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { nicheColor, listScopeNiches } from '@/lib/scope';
import { MyChannels } from '../settings/_client/my-channels';

export const metadata: Metadata = { title: 'Bienvenue' };

const STEPS = [
  { n: 1, title: 'Ajoute ta chaîne', text: 'Son nom et sa thématique suffisent.' },
  { n: 2, title: 'Choisis un sujet', text: 'Commence par ceux marqués « C’est le moment ».' },
  { n: 3, title: 'Crée ta vidéo', text: 'Elle rejoint « Mes vidéos » pour suivre sa production.' },
];

/** Premier lancement d'un client : une seule chose à faire, ajouter sa chaîne. */
export default async function BienvenuePage() {
  const user = await requireUser();
  const db = createServiceClient();
  const [existing, nichesRes, channelsRes] = await Promise.all([
    listScopeNiches(db, user.id),
    db.from('niches').select('id, name, category').eq('status', 'active').order('name'),
    db.from('user_channels').select('id, title, niche_id, youtube_channel_id').eq('user_id', user.id).order('created_at'),
  ]);
  const catalogue = ((nichesRes.data ?? []) as { id: string; name: string; category: string | null }[]).map((n) => ({
    id: n.id,
    name: n.name,
    color: nicheColor(n.category),
  }));
  const nicheName = new Map(catalogue.map((n) => [n.id, n.name]));
  const channels = ((channelsRes.data ?? []) as { id: string; title: string; niche_id: string; youtube_channel_id: string | null }[]).map((c) => ({
    id: c.id,
    title: c.title,
    nicheId: c.niche_id,
    nicheName: nicheName.get(c.niche_id) ?? '',
    youtube: c.youtube_channel_id,
  }));
  const ready = existing.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-4 py-10 md:py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        <span className="elev-2 flex h-14 w-14 items-center justify-center rounded-[16px] bg-primary text-2xl font-bold text-primary-foreground">T</span>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Bienvenue, {user.displayName}</h1>
        <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
          TubLyTI repère les sujets que ton public réclame avant qu’ils ne soient saturés. Une minute de réglage, et ta liste est prête.
        </p>
      </header>

      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className={`flex flex-col gap-1.5 rounded-2xl bg-card p-4 ${s.n === 1 && !ready ? 'ring-2 ring-primary/40' : ''}`}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-ink">{s.n}</span>
            <span className="text-[15px] font-semibold">{s.title}</span>
            <span className="text-[13px] leading-snug text-muted-foreground">{s.text}</span>
          </li>
        ))}
      </ol>

      <section aria-labelledby="ajout" className="flex flex-col gap-3">
        <h2 id="ajout" className="text-lg font-semibold">{ready ? 'Tes chaînes' : 'Ajoute ta chaîne'}</h2>
        <MyChannels channels={channels} catalogue={catalogue} />
      </section>

      {ready && (
        <Link
          href="/sujets"
          className="inline-flex h-12 items-center justify-center rounded-[12px] bg-primary text-[15px] font-medium text-primary-foreground"
        >
          Voir mes sujets
        </Link>
      )}
    </div>
  );
}
