import type { Metadata } from 'next';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { nicheColor } from '@/lib/scope';
import { MyChannels } from './_client/my-channels';
import { FollowedNiches } from './_client/followed-niches';
import { ProfileForm } from './_client/profile-form';
import { ThemeChoice } from './_client/theme-choice';

export const metadata: Metadata = { title: 'Réglages' };

/** Réglages du client : ses chaînes, les thématiques qu'il suit, son profil, l'apparence. */
export default async function SettingsPage() {
  const user = await requireUser();
  const db = createServiceClient();
  const [channelsRes, followedRes, nichesRes] = await Promise.all([
    db.from('user_channels').select('id, title, niche_id, youtube_channel_id').eq('user_id', user.id).order('created_at'),
    db.from('user_niches').select('niche_id').eq('user_id', user.id),
    db.from('niches').select('id, name, category').eq('status', 'active').order('name'),
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
    nicheName: nicheName.get(c.niche_id) ?? 'Thématique retirée',
    youtube: c.youtube_channel_id,
  }));
  const followed = ((followedRes.data ?? []) as { niche_id: string }[]).map((f) => f.niche_id);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-10 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">Réglages</h1>
        <p className="text-[15px] text-muted-foreground">Tes chaînes décident des sujets que TubLyTI te montre.</p>
      </header>

      <section id="chaines" aria-labelledby="titre-chaines" className="flex scroll-mt-6 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="titre-chaines" className="text-lg font-semibold">Mes chaînes</h2>
          <p className="text-sm text-muted-foreground">Une chaîne par thématique. Chaque chaîne apparaît dans le sélecteur « Afficher » de la barre latérale.</p>
        </div>
        <MyChannels channels={channels} catalogue={catalogue} />
      </section>

      <section aria-labelledby="titre-themes" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="titre-themes" className="text-lg font-semibold">Thématiques à explorer</h2>
          <p className="text-sm text-muted-foreground">Suis une thématique sans y avoir de chaîne, pour repérer des sujets avant de te lancer.</p>
        </div>
        <FollowedNiches catalogue={catalogue} followed={followed} withChannel={channels.map((c) => c.nicheId)} />
      </section>

      <section aria-labelledby="titre-profil" className="flex flex-col gap-3">
        <h2 id="titre-profil" className="text-lg font-semibold">Profil</h2>
        <ProfileForm displayName={user.displayName} email={user.email} />
      </section>

      <section aria-labelledby="titre-apparence" className="flex flex-col gap-3">
        <h2 id="titre-apparence" className="text-lg font-semibold">Apparence</h2>
        <ThemeChoice />
      </section>
    </div>
  );
}
