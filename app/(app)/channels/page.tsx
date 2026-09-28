import Link from 'next/link';
import { Tv } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/server';
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
  const db = await createClient();

  const [channelsResult, nichesResult] = await Promise.all([
    db
      .from('channels')
      .select('id, title, subscriber_count, last_checked_at, niche_id, niches(name)')
      .order('last_checked_at', { ascending: true, nullsFirst: true }),
    db.from('niches').select('id, name').order('name'),
  ]);

  const channels = (channelsResult.data ?? []) as unknown as Channel[];
  const niches = (nichesResult.data ?? []) as unknown as Niche[];
  const fetchError = channelsResult.error?.message ?? null;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quelles chaînes surveiller ?</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Ajoutez les chaînes YouTube de votre niche. TubLyTI analysera leurs vidéos
            et les commentaires de leur audience pour détecter les opportunités.
          </p>
        </div>
        <Link
          href="/channels/candidates"
          className="h-9 px-3.5 rounded-lg border border-border text-sm font-medium flex items-center hover:bg-muted transition-colors shrink-0"
        >
          Chaînes candidates
        </Link>
      </div>

      {/* Add channel form (client island) */}
      <AddChannelForm niches={niches} />

      {/* Channel list */}
      {fetchError && channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-destructive">
              Impossible de charger les chaînes
            </p>
            <p className="text-xs text-muted-foreground mt-1">{fetchError}</p>
          </CardContent>
        </Card>
      ) : channels.length === 0 ? (
        <Card className="border-dashed border-2 border-primary/20">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary-soft text-primary-ink mb-4">
              <Tv className="size-6" />
            </div>
            <p className="font-semibold text-foreground">
              Aucune chaîne suivie pour l&apos;instant
            </p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md">
              Collez l&apos;URL ou l&apos;ID d&apos;une chaîne YouTube dans le formulaire ci-dessus,
              choisissez sa niche, et cliquez sur Ajouter. TubLyTI commencera à analyser
              ses vidéos et les commentaires de son audience.
            </p>
            <div className="flex flex-col items-start gap-2 mt-6 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary-soft text-primary-ink text-xs font-bold">1</span>
                Copiez l&apos;URL d&apos;une chaîne YouTube
              </p>
              <p className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary-soft text-primary-ink text-xs font-bold">2</span>
                Sélectionnez la niche correspondante
              </p>
              <p className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary-soft text-primary-ink text-xs font-bold">3</span>
                Cliquez sur Ajouter — c&apos;est tout !
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {channels.length} chaîne{channels.length > 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-left">
                    <th className="px-3 py-2.5 font-medium rounded-tl-md">Chaîne</th>
                    <th className="px-3 py-2.5 font-medium">Niche</th>
                    <th className="px-3 py-2.5 font-medium">Abonnés</th>
                    <th className="px-3 py-2.5 font-medium">Dernière vérification</th>
                    <th className="px-3 py-2.5 font-medium rounded-tr-md w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((ch) => (
                    <tr
                      key={ch.id}
                      className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium">{ch.title ?? ch.id}</td>
                      <td className="px-3 py-2.5">
                        {ch.niches?.name ? (
                          <Badge variant="secondary">{ch.niches.name}</Badge>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {ch.subscriber_count
                          ? ch.subscriber_count.toLocaleString('fr-FR')
                          : '--'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {formatDate(ch.last_checked_at)}
                      </td>
                      <td className="px-3 py-2.5">
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
