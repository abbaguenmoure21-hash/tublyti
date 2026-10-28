import Link from 'next/link';
import { Settings, XCircle } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { getQuotaSoftLimit } from '@/lib/youtube/quota';
import { jobLabel } from '@/lib/jobs/labels';
import {
  groupRuns,
  lastNightlyRun,
  nightlyDeadlineMin,
  jobState,
  jobDurationMs,
  formatDuration,
  formatWhen,
  formatNightDate,
  SKIPPED_REASON,
  relaunchCost,
  type JobRow,
  type JobState,
} from '@/lib/admin/job-status';
import { NightSummary, JobStatusBadge } from '../_components/job-status';
import { CronButtons } from './_components/cron-buttons';

export const metadata = { title: 'Collecte' };

const FILTERS: { value: 'tout' | 'erreur' | 'sautee'; label: string; states: JobState[] | null }[] = [
  { value: 'tout', label: 'Toutes', states: null },
  { value: 'erreur', label: 'Erreurs', states: ['error'] },
  { value: 'sautee', label: 'Sautées', states: ['skipped'] },
];

function JobLine({ job, longest }: { job: JobRow; longest: boolean }) {
  const state = jobState(job);
  const ms = jobDurationMs(job);
  return (
    <li className="flex flex-col gap-1.5 border-t border-muted px-4 py-3 text-sm first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 font-medium">{jobLabel(job.kind)}</span>
        <JobStatusBadge job={job} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        <span>{formatWhen(job.started_at)}</span>
        <span className={longest ? 'font-medium text-foreground' : ''}>
          {ms === null ? 'En cours…' : formatDuration(ms)}
          {longest && ' · la plus longue'}
        </span>
        <span>{(job.quota_used ?? 0).toLocaleString('fr-FR')} unités de quota</span>
        <span>{(job.items_processed ?? 0).toLocaleString('fr-FR')} éléments traités</span>
      </div>
      {state === 'skipped' && <p className="text-xs text-muted-foreground">{SKIPPED_REASON}</p>}
      {state === 'error' && (
        <details className="text-xs">
          <summary className="cursor-pointer text-destructive">Voir l’erreur</summary>
          <p className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 font-mono text-foreground">{job.error}</p>
        </details>
      )}
    </li>
  );
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ etat?: string }> }) {
  await requireAdmin();
  const { etat } = await searchParams;
  const filter = FILTERS.find((f) => f.value === etat) ?? FILTERS[0];

  // Page de la console (protégée par requireAdmin) : lecture avec la clé de service.
  // ~21 steps per night: 200 rows hold the last 7+ nights.
  const db = createServiceClient();
  const { data, error } = await db
    .from('jobs')
    .select('id, kind, started_at, finished_at, quota_used, items_processed, error')
    .order('started_at', { ascending: false })
    .limit(200);

  const jobs = (data ?? []) as JobRow[];
  const runs = groupRuns(jobs).slice(0, 7);
  const lastRun = lastNightlyRun(runs);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Collecte</h1>
        <p className="text-sm text-muted-foreground">
          Les étapes de nuit qui mettent à jour les données, et leur relance manuelle en cas de panne.
        </p>
      </header>

      {!error && <NightSummary run={lastRun} deadlineMin={nightlyDeadlineMin()} quotaLimit={getQuotaSoftLimit()} />}

      <CronButtons cost={relaunchCost(jobs)} />

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <XCircle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">
            Impossible de charger l’historique de la collecte. Recharge la page dans un instant.
          </p>
        </div>
      )}

      {!error && jobs.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16 text-center">
          <Settings className="mb-3 size-10 text-muted-foreground/50" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">Aucune étape enregistrée pour le moment.</p>
          <p className="mt-1 text-xs text-muted-foreground">La première collecte de nuit apparaîtra ici.</p>
        </div>
      )}

      {!error && jobs.length > 0 && (
        <section aria-labelledby="historique" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="historique" className="text-lg font-semibold">Historique des 7 dernières nuits</h2>
            <nav aria-label="Filtrer les étapes" className="well flex gap-0.5 rounded-[12px] bg-muted p-[3px]">
              {FILTERS.map((f) => (
                <Link
                  key={f.value}
                  href={f.value === 'tout' ? '/admin/jobs' : `/admin/jobs?etat=${f.value}`}
                  aria-current={f.value === filter.value ? 'page' : undefined}
                  className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${f.value === filter.value ? 'elev-1 bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {f.label}
                </Link>
              ))}
            </nav>
          </div>

          {runs.map((run, i) => {
            const shown = filter.states ? run.jobs.filter((j) => filter.states!.includes(jobState(j))) : run.jobs;
            const longestId = run.jobs.reduce<{ id: string | null; ms: number }>(
              (acc, j) => {
                const ms = jobDurationMs(j) ?? 0;
                return ms > acc.ms ? { id: j.id, ms } : acc;
              },
              { id: null, ms: 0 },
            ).id;
            return (
              <details key={run.start} open={i === 0} className="overflow-hidden rounded-xl border border-border bg-card">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <span className="font-semibold">{formatNightDate(run.start)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {run.jobs.length} étape{run.jobs.length > 1 ? 's' : ''} · {formatDuration(run.totalMs)} · {run.quota.toLocaleString('fr-FR')} unités
                  </span>
                  {run.errors > 0 && <span className="font-medium text-destructive">{run.errors} erreur{run.errors > 1 ? 's' : ''}</span>}
                  {run.skipped > 0 && <span className="text-muted-foreground">{run.skipped} sautée{run.skipped > 1 ? 's' : ''}</span>}
                </summary>
                <ul className="border-t border-border">
                  {shown.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">Aucune étape de ce type cette nuit-là.</li>}
                  {shown.map((job) => (
                    <JobLine key={job.id} job={job} longest={job.id === longestId} />
                  ))}
                </ul>
              </details>
            );
          })}
        </section>
      )}
    </div>
  );
}
