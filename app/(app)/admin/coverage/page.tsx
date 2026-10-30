import { createServiceClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle, Radio, Users, Video, Gauge } from 'lucide-react';
import { getQuotaSoftLimit } from '@/lib/youtube/quota';
import { YT_DAILY_CAP } from '@/lib/admin/job-status';
import {
  DEFAULT_TARGET_CHANNELS,
  coverageGoalText,
  formatDayKey,
  isCoverageSufficient,
  isoDaysAgo,
  localDayKey,
} from '@/lib/admin/coverage';

// Données lues à chaque visite (jamais calculées pendant pnpm build).
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Couverture et quota' };

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

const PLAN_LABELS: Record<string, string> = {
  tracking: 'Suivi des chaînes',
  discovery: 'Découverte',
  comments: 'Commentaires',
  reserve: 'Réserve',
};

function quotaTone(total: number, softLimit: number) {
  if (total > YT_DAILY_CAP) return 'text-destructive';
  if (total > softLimit) return 'text-phase-1-ink';
  return '';
}

export default async function CoveragePage() {
  // Page de la console (protégée par requireAdmin) : lecture avec la clé de service.
  const db = createServiceClient();
  const softLimit = getQuotaSoftLimit();

  // --- Niche coverage ---
  const { data: niches, error: nichesError } = await db
    .from('niches')
    .select('id, name, target_channels, coverage_sufficient');
  if (nichesError) throw new Error(nichesError.message);

  // Toutes les niches en parallèle (avant : une par une, avec de longues listes d'identifiants de chaînes).
  const cutoff90d = isoDaysAgo(90);
  const coverageData: NicheCoverage[] = await Promise.all(
    ((niches ?? []) as { id: string; name: string; target_channels: number | null; coverage_sufficient: boolean | null }[]).map(async (niche) => {
      const [ch, cand, vid] = await Promise.all([
        db.from('channels').select('id', { count: 'exact', head: true }).eq('niche_id', niche.id),
        db.from('candidate_channels').select('id', { count: 'exact', head: true }).eq('niche_id', niche.id).eq('status', 'accepted'),
        db
          .from('videos')
          .select('id, channels!inner(niche_id)', { count: 'exact', head: true })
          .eq('channels.niche_id', niche.id)
          .gte('published_at', cutoff90d),
      ]);
      const failed = ch.error ?? cand.error ?? vid.error;
      if (failed) throw new Error(failed.message);
      const channelCount = (ch.count ?? 0) + (cand.count ?? 0);
      const targetChannels = niche.target_channels ?? DEFAULT_TARGET_CHANNELS;
      const videoCount90d = vid.count ?? 0;
      return {
        id: niche.id,
        name: niche.name,
        channelCount,
        candidateCount: cand.count ?? 0,
        videoCount90d,
        targetChannels,
        sufficient: isCoverageSufficient({ channelCount, videoCount90d, targetChannels, flagged: niche.coverage_sufficient }),
      };
    }),
  );

  // --- Quota usage (last 30 days from jobs table) ---
  const { data: jobs, error: jobsError } = await db
    .from('jobs')
    .select('kind, started_at, quota_used')
    .gte('started_at', isoDaysAgo(30))
    .order('started_at', { ascending: false });
  if (jobsError) throw new Error(jobsError.message);

  const quotaByDay = new Map<string, QuotaDay>();
  for (const job of jobs ?? []) {
    const date = localDayKey(job.started_at);
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
  const latest = quotaDays[0] ?? null;

  // --- Quota plan ---
  const { data: planSetting, error: planError } = await db.from('settings').select('value').eq('key', 'quota_plan').maybeSingle();
  if (planError) throw new Error(planError.message);
  const quotaPlan = (planSetting?.value as Record<string, number> | undefined) ?? { tracking: 3500, discovery: 3000, comments: 2000, reserve: 1500 };
  const totalBudget = Object.values(quotaPlan).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 md:px-8">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Couverture et quota</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Nombre de chaînes analysées par niche et consommation du quota YouTube.
        </p>
      </div>

      {/* Latest day vs daily cap */}
      <section aria-label="Quota du dernier jour" className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-4 elev-1">
        {latest ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-muted-foreground">Dernier jour de collecte · {formatDayKey(latest.date)}</p>
              <p className={`text-base font-semibold tabular-nums ${quotaTone(latest.total, softLimit)}`}>
                {latest.total.toLocaleString('fr-FR')} <span className="font-normal text-muted-foreground">/ {YT_DAILY_CAP.toLocaleString('fr-FR')} unités</span>
              </p>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Quota YouTube utilisé"
              aria-valuemin={0}
              aria-valuemax={YT_DAILY_CAP}
              aria-valuenow={latest.total}
            >
              <div
                className={`h-full rounded-full ${latest.total > YT_DAILY_CAP ? 'bg-destructive' : latest.total > softLimit ? 'bg-warning' : 'bg-primary'}`}
                style={{ width: `${Math.min(100, (latest.total / YT_DAILY_CAP) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Limite de sécurité : {softLimit.toLocaleString('fr-FR')} unités. Au-delà, la collecte s’arrête d’elle-même.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune consommation de quota enregistrée sur les 30 derniers jours.</p>
        )}
      </section>

      {/* Coverage by niche */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" aria-hidden="true" />
            Couverture par niche
          </CardTitle>
        </CardHeader>
        <CardContent>
          {coverageData.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Aucune niche configurée.</p>
          ) : (
            <div className="space-y-5">
              {coverageData.map((niche) => {
                const progress = Math.min(100, Math.round((niche.channelCount / niche.targetChannels) * 100));
                return (
                  <div key={niche.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{niche.name}</span>
                        {niche.sufficient ? (
                          <Badge className="bg-phase-2-soft text-phase-2-ink text-xs">
                            <CheckCircle className="w-3 h-3 mr-1" aria-hidden="true" /> Suffisant
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1" aria-hidden="true" /> Insuffisant
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {niche.channelCount.toLocaleString('fr-FR')} / {niche.targetChannels.toLocaleString('fr-FR')} chaînes
                      </span>
                    </div>
                    <div
                      className="w-full h-2 bg-muted rounded-full overflow-hidden"
                      role="progressbar"
                      aria-label={`Couverture de ${niche.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                    >
                      <div
                        className={`h-full rounded-full transition-all ${niche.sufficient ? 'bg-phase-2' : 'bg-primary'}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Radio className="w-3 h-3" aria-hidden="true" /> {(niche.channelCount - niche.candidateCount).toLocaleString('fr-FR')} suivies + {niche.candidateCount.toLocaleString('fr-FR')} acceptées
                      </span>
                      <span className="flex items-center gap-1">
                        <Video className="w-3 h-3" aria-hidden="true" /> {niche.videoCount90d.toLocaleString('fr-FR')} vidéos sur 90 jours
                      </span>
                      <span>{coverageGoalText(niche.targetChannels)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quota plan */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="w-5 h-5" aria-hidden="true" />
            Plan de quota ({totalBudget.toLocaleString('fr-FR')} / {YT_DAILY_CAP.toLocaleString('fr-FR')} unités par jour)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(quotaPlan).map(([key, value]) => (
              <div key={key} className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-lg font-semibold tabular-nums">{value.toLocaleString('fr-FR')}</div>
                <div className="text-xs text-muted-foreground">{PLAN_LABELS[key] ?? key}</div>
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
              Aucune consommation de quota enregistrée sur les 30 derniers jours.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Jour</th>
                    <th className="px-3 py-2 text-right font-medium">Suivi</th>
                    <th className="px-3 py-2 text-right font-medium">Découverte</th>
                    <th className="px-3 py-2 text-right font-medium">Commentaires</th>
                    <th className="px-3 py-2 text-right font-medium">Autres</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quotaDays.map((day) => {
                    const over = day.total > softLimit;
                    return (
                      <tr key={day.date} className="border-b border-border/50 last:border-0">
                        <td className="px-3 py-2 text-xs">{formatDayKey(day.date)}</td>
                        <td className={`px-3 py-2 text-right text-xs ${day.tracking > (quotaPlan.tracking ?? Infinity) ? 'text-phase-1-ink font-medium' : ''}`}>{day.tracking.toLocaleString('fr-FR')}</td>
                        <td className={`px-3 py-2 text-right text-xs ${day.discovery > (quotaPlan.discovery ?? Infinity) ? 'text-phase-1-ink font-medium' : ''}`}>{day.discovery.toLocaleString('fr-FR')}</td>
                        <td className={`px-3 py-2 text-right text-xs ${day.comments > (quotaPlan.comments ?? Infinity) ? 'text-phase-1-ink font-medium' : ''}`}>{day.comments.toLocaleString('fr-FR')}</td>
                        <td className="px-3 py-2 text-right text-xs">{day.other.toLocaleString('fr-FR')}</td>
                        <td className={`px-3 py-2 text-right text-xs font-semibold ${quotaTone(day.total, softLimit)}`}>
                          {day.total.toLocaleString('fr-FR')}
                          {over && <span className="block text-[11px] font-normal">au-dessus de la limite</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border text-muted-foreground">
                    <td className="px-3 py-2 text-xs font-medium">Prévu</td>
                    <td className="px-3 py-2 text-right text-xs">{(quotaPlan.tracking ?? 0).toLocaleString('fr-FR')}</td>
                    <td className="px-3 py-2 text-right text-xs">{(quotaPlan.discovery ?? 0).toLocaleString('fr-FR')}</td>
                    <td className="px-3 py-2 text-right text-xs">{(quotaPlan.comments ?? 0).toLocaleString('fr-FR')}</td>
                    <td className="px-3 py-2 text-right text-xs">{(quotaPlan.reserve ?? 0).toLocaleString('fr-FR')}</td>
                    <td className="px-3 py-2 text-right text-xs font-medium">{softLimit.toLocaleString('fr-FR')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
