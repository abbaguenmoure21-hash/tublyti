import Link from 'next/link';
import { Tv, ExternalLink } from 'lucide-react';

export const metadata = { title: 'Chaînes suivies' };
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createServiceClient } from '@/lib/supabase/server';
import { AddChannelForm } from './_components/add-channel-form';
import { DeleteChannelButton } from './_components/delete-channel-button';

interface Channel {
  id: string;
  title: string | null;
  subscriber_count: number | null;
  last_checked_at: string | null;
  niche_id: string;
  niches: { name: string } | null;
}

interface Niche {
  id: string;
  name: string;
}

function formatDate(d: string | null) {
  if (!d) return 'Jamais';
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function ChannelsPage() {
  const db = createServiceClient();

  const [channelsResult, nichesResult, candidatesResult] = await Promise.all([
    db
      .from('channels')
      .select('id, title, subscriber_count, last_checked_at, niche_id, niches(name)')
      .order('last_checked_at', { ascending: true, nullsFirst: true }),
    db.from('niches').select('id, name').order('name'),
    db
      .from('candidate_channels')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ]);

  const channels = (channelsResult.data ?? []) as unknown as Channel[];
  const niches = (nichesResult.data ?? []) as unknown as Niche[];
  const candidatesCount = candidatesResult.count ?? 0;
  const fetchError = channelsResult.error?.message ?? null;

  return (
    <div className="flex-1 flex flex-col min-h-full relative overflow-x-clip">
      {/* Background gradients multi-niveaux */}
      <div className="absolute inset-0 pointer-events-none -z-10">
      </div>

      <div className="flex-1 p-6 md:px-12 md:py-10 flex flex-col gap-8 w-full max-w-5xl mx-auto">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] font-bold tracking-tight text-foreground leading-tight">
              Quelles chaînes surveiller ?
            </h1>
            <p className="text-[16px] font-medium text-muted-foreground/80 max-w-2xl">
              Ajoutez les chaînes YouTube de votre niche. TubLyTI analysera leurs vidéos
              et les commentaires de leur audience pour détecter les opportunités.
            </p>
          </div>
          <Link
            href="/channels/candidates"
            className="haptic-btn whitespace-nowrap h-[40px] pl-5 pr-3 rounded-full text-[14px] font-bold transition-all shadow-sm border bg-white dark:bg-white/10 border-black/5 dark:border-white/10 text-foreground hover:bg-black/5 dark:hover:bg-white/20 flex items-center gap-2 shrink-0"
          >
            Chaînes candidates
            {candidatesCount > 0 && (
              <span className="bg-secondary text-secondary-foreground text-[12px] font-bold px-2 py-0.5 rounded-full ml-1">
                {candidatesCount}
              </span>
            )}
          </Link>
        </div>

      {/* Add channel form (client island) */}
      <AddChannelForm niches={niches} />

      {/* Channel list */}
      {fetchError && channels.length === 0 ? (
        <div className="bento-card !py-16 text-center flex flex-col items-center justify-center">
          <p className="text-[14px] font-semibold text-destructive">
            Impossible de charger les chaînes
          </p>
          <p className="text-[13px] text-muted-foreground mt-1.5">{fetchError}</p>
        </div>
      ) : channels.length === 0 ? (
        <div className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-[0_4px_20px_rgb(0,0,0,0.03)] rounded-[24px] overflow-hidden py-24 flex flex-col items-center justify-center text-center">
          <div className="flex items-center justify-center w-[64px] h-[64px] rounded-full bg-gradient-to-b from-primary/20 to-blue-600/20 text-primary mb-6 shadow-[0_4px_16px_rgba(10,132,255,0.15)] ring-1 ring-primary/20">
            <Tv className="w-8 h-8" />
          </div>
          <p className="text-[20px] font-bold text-foreground tracking-tight">
            Aucune chaîne suivie pour l'instant
          </p>
          <p className="text-[15px] text-muted-foreground mt-3 max-w-[460px] leading-relaxed">
            Collez l'URL ou l'ID d'une chaîne YouTube dans le formulaire ci-dessus,
            choisissez sa niche, et cliquez sur Ajouter. TubLyTI commencera à analyser
            ses vidéos et les commentaires de son audience.
          </p>
          <div className="flex flex-col items-start gap-4 mt-10 text-[14px] text-muted-foreground font-medium bg-black/5 dark:bg-white/5 p-6 rounded-[20px] border border-black/5 dark:border-white/10">
            <p className="flex items-center gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-background border border-border text-foreground text-[12px] font-bold shadow-sm">1</span>
              Copiez l'URL d'une chaîne YouTube
            </p>
            <p className="flex items-center gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-background border border-border text-foreground text-[12px] font-bold shadow-sm">2</span>
              Sélectionnez la niche correspondante
            </p>
            <p className="flex items-center gap-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-background border border-border text-foreground text-[12px] font-bold shadow-sm">3</span>
              Cliquez sur Ajouter — c'est tout !
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-[0_4px_20px_rgb(0,0,0,0.03)] rounded-[24px] overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-black/5 dark:border-white/10 bg-black/5 dark:bg-white/5">
            <h2 className="text-[18px] font-bold text-foreground">
              {channels.length} chaîne{channels.length > 1 ? 's' : ''} surveillée{channels.length > 1 ? 's' : ''}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="bg-black/5 dark:bg-black/20 text-muted-foreground text-left text-[12px] font-bold uppercase tracking-wider">
                  <th className="px-6 py-4">Chaîne</th>
                  <th className="px-6 py-4">Niche</th>
                  <th className="px-6 py-4">Abonnés</th>
                  <th className="px-6 py-4">Dernière vérification</th>
                  <th className="px-6 py-4 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {channels.map((ch) => (
                  <tr
                    key={ch.id}
                    className="border-b border-black/5 dark:border-white/10 last:border-0 hover:bg-white/50 dark:hover:bg-white/5 transition-colors group"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 border border-black/10 dark:border-white/10 shadow-sm">
                          <AvatarImage src={`https://unavatar.io/youtube/${ch.id}`} alt={ch.title ?? ch.id} />
                          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-blue-600/20 text-primary font-bold">
                            {(ch.title ?? ch.id).substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <Link
                            href={`https://youtube.com/channel/${ch.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold text-foreground text-[14px] hover:text-primary transition-colors flex items-center gap-1.5"
                          >
                            <span className="truncate max-w-[250px] block">{ch.title ?? ch.id}</span>
                            <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </Link>
                          <span className="text-[12px] text-muted-foreground/70 font-medium">
                            {ch.id.startsWith('UC') ? 'YouTube' : 'Source'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {ch.niches?.name ? (
                        <div className="inline-flex items-center bg-black/5 dark:bg-white/10 border border-black/5 dark:border-white/5 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full text-foreground/70 shadow-sm max-w-[180px]">
                          <span className="truncate">{ch.niches.name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </td>
                    <td className="px-6 py-4 tabular-nums font-bold text-foreground/80">
                      {ch.subscriber_count
                        ? ch.subscriber_count.toLocaleString('fr-FR')
                        : '--'}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground font-medium text-[13px]">
                      {formatDate(ch.last_checked_at)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <DeleteChannelButton
                        channelId={ch.id}
                        channelTitle={ch.title ?? ch.id}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
