import { createServiceClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle, Radio, Users, Video, Gauge } from 'lucide-react';

export const metadata = { title: 'Couverture & Quota' };

interface NicheCoverage {
  id: string;
  name: string;
  channelCount: number;
  candidateCount: number;
  videoCount90d: number;
  targetChannels: number;
  sufficient: boolean;
}

interface QuotaDay {
  date: string;
  tracking: number;
  discovery: number;
  comments: number;
  other: number;
  total: number;
}

export default async function CoveragePage() {
  // Page de la console (protégée par requireAdmin) : lecture avec la clé de service.
  const db = createServiceClient();

  // --- Niche coverage ---
  const { data: niches } = await db
    .from('niches')
    .select('id, name, target_channels, coverage_sufficient');

  const coverageData: NicheCoverage[] = [];
  for (const niche of niches ?? []) {
    const [{ count: channelCount }, { count: candidateCount }] = await Promise.all([
      db.from('channels').select('id', { count: 'exact', head: true }).eq('niche_id', niche.id),
      db.from('candidate_channels').select('id', { count: 'exact', head: true }).eq('niche_id', niche.id).eq('status', 'accepted'),
    ]);

    // Count videos in last 90 days for channels in this niche
    const cutoff90d = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data: nicheChannels } = await db
      .from('channels')
      .select('id')
      .eq('niche_id', niche.id);
    const channelIds = ((nicheChannels ?? []) as { id: string }[]).map((c) => c.id);

    let videoCount = 0;
    if (channelIds.length > 0) {
      const { count } = await db
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .in('channel_id', channelIds)
        .gte('published_at', cutoff90d);
      videoCount = count ?? 0;
    }

    coverageData.push({
      id: niche.id,
      name: niche.name,
      channelCount: (channelCount ?? 0) + (candidateCount ?? 0),
      candidateCount: candidateCount ?? 0,
      videoCount90d: videoCount,
      targetChannels: niche.target_channels ?? 1500,
      sufficient: niche.coverage_sufficient ?? false,
    });
  }

  // --- Quota usage (last 30 days from jobs table) ---
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: jobs } = await db
    .from('jobs')
    .select('kind, started_at, quota_used')
    .gte('started_at', thirtyDaysAgo)
    .order('started_at', { ascending: false });

  const quotaByDay = new Map<string, QuotaDay>();
  for (const job of jobs ?? []) {
    const date = new Date(job.started_at).toISOString().slice(0, 10);
    const existing = quotaByDay.get(date) ?? { date, tracking: 0, discovery: 0, comments: 0, other: 0, total: 0 };

    const quota = job.quota_used ?? 0;
    if (job.kind === 'collect') existing.tracking += quota;
    else if (['discover-channels', 'discover-sources'].includes(job.kind)) existing.discovery += quota;
    else if (job.kind === 'comments') existing.comments += quota;
    else existing.other += quota;
    existing.total += quota;

    quotaByDay.set(date, existing);
  }
  const quotaDays = [...quotaByDay.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);

  // --- Quota plan ---
  const { data: planSetting } = await db.from('settings').select('value').eq('key', 'quota_plan').single();
  const quotaPlan = (planSetting?.value as Record<string, number>) ?? { tracking: 3500, discovery: 3000, comments: 2000, reserve: 1500 };
  const totalBudget = Object.values(quotaPlan).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 md:px-8">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Couverture et quota</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Nombre de chaînes analysées par niche et consommation du quota YouTube.
        </p>
      </div>

      {/* Coverage by niche */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Couverture par niche
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {coverageData.map((niche) => {
              const progress = Math.min(100, Math.round((niche.channelCount / niche.targetChannels) * 100));
              const isSufficient = niche.channelCount >= 1000 && niche.videoCount90d >= 20000;
              return (
                <div key={niche.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{niche.name}</span>
                      {isSufficient ? (
                        <Badge className="bg-phase-2-soft text-phase-2-ink text-xs">
                          <CheckCircle className="w-3 h-3 mr-1" /> Suffisant
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Insuffisant
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">
                      {niche.channelCount.toLocaleString('fr-FR')} / {niche.targetChannels.toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${progress}%`,
                        backgroundColor: isSufficient ? 'var(--phase-2-ink)' : 'hsl(var(--primary))',
                      }}
                    />
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Radio className="w-3 h-3" /> {niche.channelCount - niche.candidateCount} suivies + {niche.candidateCount} candidates
                    </span>
                    <span className="flex items-center gap-1">
                      <Video className="w-3 h-3" /> {niche.videoCount90d.toLocaleString('fr-FR')} vidéos (90j)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Quota plan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="w-5 h-5" />
            Budget quota ({totalBudget.toLocaleString('fr-FR')} / 10 000 unités/jour)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(quotaPlan).map(([key, value]) => (
              <div key={key} className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-lg font-bold font-mono">{value.toLocaleString('fr-FR')}</div>
                <div className="text-xs text-muted-foreground">{({ tracking: 'Suivi des chaînes', discovery: 'Découverte', comments: 'Commentaires', reserve: 'Réserve' } as Record<string, string>)[key] ?? key}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quota usage history */}
      <Card>
        <CardHeader>
          <CardTitle>Consommation quotidienne (14 derniers jours)</CardTitle>
        </CardHeader>
        <CardContent>
          {quotaDays.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Aucune donnée de quota disponible.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Suivi</th>
                    <th className="px-3 py-2 text-right font-medium">Découverte</th>
                    <th className="px-3 py-2 text-right font-medium">Commentaires</th>
                    <th className="px-3 py-2 text-right font-medium">Autres</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quotaDays.map((day) => (
                    <tr key={day.date} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{day.date}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{day.tracking.toLocaleString('fr-FR')}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{day.discovery.toLocaleString('fr-FR')}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{day.comments.toLocaleString('fr-FR')}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{day.other.toLocaleString('fr-FR')}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-bold">
                        {day.total.toLocaleString('fr-FR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
