import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { readAllPages } from '@/lib/supabase/rpc-fallback';
import { requireAdmin } from '@/lib/auth/session';
import { jobLabel } from '@/lib/jobs/labels';
import { isSensitiveTopic } from '@/lib/topics/sensitive';
import { getQuotaSoftLimit } from '@/lib/youtube/quota';
import { groupRuns, lastNightlyRun, nightlyDeadlineMin, jobState, isFailure, SKIPPED_REASON, INTERRUPTED_REASON, type JobRow } from '@/lib/admin/job-status';
import { NightSummary, JobStatusBadge } from './_components/job-status';

export const metadata = { title: 'Console d’admin' };


function ago(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'il y a moins d’une heure';
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} jours`;
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Console d'admin · vue d'ensemble : la dernière nuit, ce qui demande une décision, puis les chiffres. */
export default async function AdminPage() {
  await requireAdmin();
  const db = createServiceClient();
  const weekAgo = daysAgoIso(7);
  const results = await Promise.all([
    // Paginated: limit(2000) was capped at 1,000 rows, so the sensitive count could be too low.
    readAllPages<{ id: string; label: string }>((from, to) => db.from('topics').select('id, label').eq('status', 'proposed').order('id').range(from, to)),
    db.from('candidate_channels').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('channels').select('id', { count: 'exact', head: true }),
    db.from('profiles').select('user_id', { count: 'exact', head: true }).eq('role', 'client'),
    readAllPages<{ user_id: string }>((from, to) => db.from('user_channels').select('id, user_id').order('id').range(from, to)),
    db.from('waitlist').select('id', { count: 'exact', head: true }),
    // One night = ~21 rows: read enough to always hold the full last night.
    db.from('jobs').select('id, kind, started_at, finished_at, error, quota_used, items_processed').order('started_at', { ascending: false }).limit(200),
    db.from('topics').select('id', { count: 'exact', head: true }).eq('validated_by', 'auto').eq('status', 'active').gte('validated_at', weekAgo),
    db.from('candidate_channels').select('id', { count: 'exact', head: true }).in('status', ['accepted', 'followed']).gte('decided_at', weekAgo),
  ]);
  // A failed read must not look like "0": let admin/error.tsx show a real error with "Réessayer".
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  const [proposed, candidates, channels, profiles, noChannel, waitlist, jobs, autoTopics, autoChannels] = results;

  const proposedRows = proposed.data;
  const sensitiveCount = proposedRows.filter((t) => isSensitiveTopic(t.label)).length;
  const waitingCount = Math.max(0, proposedRows.length - sensitiveCount);
  const withChannel = new Set(noChannel.data.map((r) => r.user_id)).size;
  const pendingCandidates = candidates.count ?? 0;
  // Only what needs a human decision; the robot handles candidate channels every night.
  const todo = [
    {
      n: sensitiveCount,
      label: `sujet${sensitiveCount > 1 ? 's' : ''} sensible${sensitiveCount > 1 ? 's' : ''} à décider`,
      hint: `${waitingCount} autre${waitingCount > 1 ? 's' : ''} en attente du robot`,
      href: '/admin/sujets',
    },
    {
      n: waitlist.count ?? 0,
      label: `inscription${(waitlist.count ?? 0) > 1 ? 's' : ''} sur la liste d’attente`,
      hint: null,
      href: '/admin/attente',
    },
  ].filter((t) => t.n > 0);
  const stats = [
    { label: 'Clients', value: profiles.count ?? 0, hint: `${withChannel} compte${withChannel > 1 ? 's' : ''} avec au moins une chaîne` },
    { label: 'Chaînes analysées', value: channels.count ?? 0, hint: `Catalogue commun · ${pendingCandidates} chaîne${pendingCandidates > 1 ? 's' : ''} à valider (tri automatique la nuit)` },
    { label: 'Validé automatiquement', value: (autoTopics.count ?? 0) + (autoChannels.count ?? 0), hint: `7 derniers jours : ${autoTopics.count ?? 0} sujets publiés, ${autoChannels.count ?? 0} chaînes ajoutées` },
  ];
  const allJobs = (jobs.data ?? []) as JobRow[];
  const runs = groupRuns(allJobs);
  const lastRun = lastNightlyRun(runs);
  // Only the last night and any manual relaunch after it: old, already-fixed errors
  // must not contradict the banner. Failures first, then the latest steps.
  const since = lastRun?.start ?? runs[0]?.start ?? '';
  const latestJobs = allJobs.filter((j) => j.started_at >= since);
  const jobRows = [
    ...latestJobs.filter((j) => isFailure(jobState(j))),
    ...latestJobs.filter((j) => !isFailure(jobState(j))),
  ].slice(0, 8);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">Console d’admin</h1>
        <p className="text-[15px] text-muted-foreground">Le fonctionnement de TubLyTI : collecte, catalogue, validation et comptes clients. Les clients ne voient pas cet espace.</p>
      </header>

      <NightSummary run={lastRun} deadlineMin={nightlyDeadlineMin()} quotaLimit={getQuotaSoftLimit()} />

      <section aria-labelledby="a-faire" className="flex flex-col gap-3">
        <h2 id="a-faire" className="text-lg font-semibold">À traiter</h2>
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {todo.length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground">Rien à traiter pour le moment.</li>}
          {todo.map((t) => (
            <li key={t.href} className="border-b border-muted last:border-b-0">
              <Link href={t.href} className="flex min-h-11 items-center gap-3 px-4 py-3.5 hover:bg-muted/60">
                <span className="min-w-10 text-xl font-semibold tabular-nums">{t.n}</span>
                <span className="flex flex-1 flex-col">
                  <span className="text-sm">{t.label}</span>
                  {t.hint && <span className="text-xs text-muted-foreground">{t.hint}</span>}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="chiffres" className="grid gap-3 sm:grid-cols-3">
        <h2 id="chiffres" className="sr-only">Chiffres clés</h2>
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-4">
            <span className="text-[13px] text-muted-foreground">{s.label}</span>
            <span className="text-2xl font-semibold tabular-nums">{s.value.toLocaleString('fr-FR')}</span>
            <span className="text-xs text-muted-foreground">{s.hint}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="collecte" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="collecte" className="text-lg font-semibold">Dernières étapes</h2>
          <Link href="/admin/jobs" className="text-sm font-medium text-primary">Tout voir</Link>
        </div>
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {jobRows.length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground">Aucune étape enregistrée.</li>}
          {jobRows.map((j) => {
            const state = jobState(j);
            return (
              <li key={j.id} className="flex items-center gap-3 border-b border-muted px-4 py-3 text-sm last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{jobLabel(j.kind)}</span>
                  <span className="text-muted-foreground"> · {ago(j.started_at)}</span>
                  {state === 'skipped' && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{SKIPPED_REASON}</span>}
                  {state === 'interrupted' && <span className="mt-0.5 block text-xs text-destructive">{INTERRUPTED_REASON}</span>}
                  {state === 'error' && <span className="mt-0.5 block break-words text-xs text-destructive">{j.error}</span>}
                </span>
                <JobStatusBadge job={j} />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
