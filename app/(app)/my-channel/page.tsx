import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tv, TrendingUp, Users, Video } from 'lucide-react';
import { MyChannelClient } from './_components/my-channel-client';

export const metadata = { title: 'Résultats' };

export default async function MyChannelPage() {
  const user = await requireUser();
  const db = createServiceClient();

  // 1. Les chaînes déclarées par le client dans Réglages
  const { data: mine, error: mineErr } = await db.from('user_channels').select('title, youtube_channel_id').eq('user_id', user.id);
  let myChannels = (mine ?? []) as { title: string; youtube_channel_id: string | null }[];
  if (mineErr) {
    // Avant la migration 00018 : chaînes indiquées dans le catalogue des niches.
    const { data: legacy } = await db.from('niches').select('owner_channel').not('owner_channel', 'is', null);
    myChannels = ((legacy ?? []) as { owner_channel: string }[]).map((n) => ({ title: n.owner_channel, youtube_channel_id: n.owner_channel }));
  }
  const ownerChannelNames = myChannels.map((c) => c.title);
  const ownerChannelIds = myChannels.map((c) => c.youtube_channel_id).filter((x): x is string => Boolean(x && x.startsWith('UC')));

  // 2. Retrouver ces chaînes parmi les chaînes analysées (par identifiant YouTube, sinon par nom)
  let matchingChannels: any[] = [];
  if (ownerChannelIds.length > 0) {
    const { data: channelsById } = await db.from('channels').select('*').in('id', ownerChannelIds);
    matchingChannels = channelsById ?? [];
  }
  if (ownerChannelNames.length > 0) {
    const { data: channels } = await db.from('channels').select('*').in('title', ownerChannelNames);
    const existingIds = new Set(matchingChannels.map((c) => c.id));
    for (const c of channels ?? []) {
      if (!existingIds.has(c.id)) matchingChannels.push(c);
    }
  }

  if (matchingChannels.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-ink">
          <Video className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Pas encore de résultats</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {myChannels.length
            ? 'Ta chaîne n’est pas encore dans les données de TubLyTI. Ajoute son adresse YouTube dans Réglages : ses vidéos seront mesurées après la prochaine collecte.'
            : 'Ajoute ta chaîne et son adresse YouTube dans Réglages pour comparer les vues de tes vidéos à ta moyenne habituelle.'}
        </p>
        <Link href="/settings#chaines" className="mt-2 inline-flex h-11 items-center rounded-[10px] bg-primary px-5 text-[15px] font-medium text-primary-foreground hover:opacity-90">
          Ouvrir Réglages
        </Link>
      </div>
    );
  }

  // 3. For the first matching channel (or we can let user select if multiple, but let's just pick first for MVP)
  const channel = matchingChannels[0];

  // Fetch videos for this channel
  const { data: videos } = await db
    .from('videos')
    .select('id, title, published_at, duration_s')
    .eq('channel_id', channel.id)
    .order('published_at', { ascending: false, nullsFirst: false });

  const videoIds = (videos ?? []).map((v: any) => v.id);

  // Fetch video snapshots for these videos
  let snapshots: any[] = [];
  if (videoIds.length > 0) {
    const { data: snaps } = await db
      .from('video_snapshots')
      .select('video_id, captured_at, views, likes, comments')
      .in('video_id', videoIds)
      .order('captured_at', { ascending: true });
    snapshots = snaps ?? [];
  }

  return (
    <div className="flex-1 flex flex-col min-h-full">
      <header className="flex flex-col gap-1.5 px-4 pt-5 md:px-8">
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">Résultats de {channel.title}</h1>
        <p className="text-[15px] text-muted-foreground">Les vues de chaque vidéo comparées à la moyenne habituelle de ta chaîne.</p>
      </header>

      <MyChannelClient 
        channel={channel} 
        videos={videos ?? []} 
        snapshots={snapshots} 
      />
    </div>
  );
}
