import { createServiceClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tv, TrendingUp, Users, Video } from 'lucide-react';
import { MyChannelClient } from './_components/my-channel-client';

export const metadata = { title: 'Ma Chaîne' };

export default async function MyChannelPage() {
  const db = createServiceClient();

  // 1. Get owner channels from niches
  const { data: niches } = await db.from('niches').select('owner_channel').not('owner_channel', 'is', null);
  const ownerChannelNames = Array.from(new Set((niches ?? []).map((n: any) => n.owner_channel).filter(Boolean))) as string[];

  // 2. Find matching channels in DB
  let matchingChannels: any[] = [];
  if (ownerChannelNames.length > 0) {
    const { data: channels } = await db
      .from('channels')
      .select('*')
      .in('title', ownerChannelNames);
    matchingChannels = channels ?? [];
    
    // Also try matching by ID just in case
    const { data: channelsById } = await db
      .from('channels')
      .select('*')
      .in('id', ownerChannelNames);
      
    const existingIds = new Set(matchingChannels.map(c => c.id));
    for (const c of (channelsById ?? [])) {
      if (!existingIds.has(c.id)) matchingChannels.push(c);
    }
  }

  if (matchingChannels.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-full">
        <header className="h-[64px] shrink-0 flex items-center px-8 border-b border-[--glass-border] bg-[--bg-surface-1]/50 backdrop-blur-xl">
          <h1 className="text-[20px] font-semibold text-foreground tracking-tight">Ma Chaîne</h1>
        </header>
        <div className="flex-1 p-6 md:p-12 max-w-4xl mx-auto w-full flex flex-col items-center justify-center text-center">
           <div className="flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-blue-600/20 text-primary mb-6 shadow-sm">
             <Video className="w-8 h-8" />
           </div>
           <h2 className="text-title-2 mb-3">Aucune chaîne liée</h2>
           <p className="text-muted-foreground text-[15px] max-w-md mx-auto mb-8">
             Pour voir vos statistiques, vous devez d'abord lier votre chaîne YouTube à une niche.
           </p>
           <div className="bg-card border border-border rounded-xl p-6 text-left w-full max-w-md shadow-sm">
             <h3 className="font-semibold text-foreground mb-4 text-[15px]">Comment faire ?</h3>
             <ol className="space-y-3 text-[14px] text-muted-foreground">
               <li className="flex gap-3"><span className="font-bold text-foreground">1.</span> Assurez-vous d'avoir ajouté votre chaîne dans l'onglet <strong>Concurrents</strong>.</li>
               <li className="flex gap-3"><span className="font-bold text-foreground">2.</span> Allez dans <strong>Réglages &gt; Niches</strong>.</li>
               <li className="flex gap-3"><span className="font-bold text-foreground">3.</span> Modifiez votre niche et indiquez le nom exact de votre chaîne dans le champ <strong>Chaîne liée</strong>.</li>
             </ol>
           </div>
        </div>
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
      <header className="h-[64px] shrink-0 flex items-center px-8 border-b border-[--glass-border] bg-[--bg-surface-1]/50 backdrop-blur-xl z-20 sticky top-0">
        <h1 className="text-[20px] font-semibold text-foreground tracking-tight">Ma Chaîne</h1>
      </header>

      <MyChannelClient 
        channel={channel} 
        videos={videos ?? []} 
        snapshots={snapshots} 
      />
    </div>
  );
}
