/**
 * Display helpers for the `jobs` table in the admin console.
 * Pure functions (no I/O) shared by /admin and /admin/jobs.
 */

export interface JobRow {
  id: string;
  kind: string;
  started_at: string;
  finished_at: string | null;
  quota_used: number | null;
  items_processed?: number | null;
  error: string | null;
  /** Optional explicit status column (added by the nightly migration); falls back to `error` parsing. */
  status?: string | null;
}

export type JobState = 'ok' | 'skipped' | 'error' | 'running';

/** A step skipped by the nightly deadline is recorded with `error = 'skipped: …'` (scripts/nightly.ts). */
export function isSkipped(job: Pick<JobRow, 'error' | 'status'>): boolean {
  if (job.status === 'skipped') return true;
  return Boolean(job.error?.toLowerCase().startsWith('skipped'));
}

export function jobState(job: JobRow): JobState {
  if (isSkipped(job)) return 'skipped';
  if (job.error || job.status === 'error' || job.status === 'failed') return 'error';
  if (job.finished_at) return 'ok';
  return 'running';
}

export const SKIPPED_REASON = 'Plus de temps cette nuit, reprend demain';

/** "4 min 12 s", "45 s", "1 h 02 min". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function jobDurationMs(job: Pick<JobRow, 'started_at' | 'finished_at'>): number | null {
  if (!job.finished_at) return null;
  return new Date(job.finished_at).getTime() - new Date(job.started_at).getTime();
}

/** "il y a 6 h · 02:14" under 7 days, otherwise "27 oct. · 02:14". */
export function formatWhen(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const h = Math.floor((now - d.getTime()) / 3_600_000);
  if (h < 1) return `il y a moins d’une heure · ${time}`;
  if (h < 48) return `il y a ${h} h · ${time}`;
  if (h < 24 * 7) return `il y a ${Math.floor(h / 24)} jours · ${time}`;
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })} · ${time}`;
}

export function formatNightDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
}

/** Gap between two consecutive jobs above which they belong to two different runs. */
const RUN_GAP_MS = 2 * 3_600_000;

export interface NightRun {
  /** Earliest started_at of the run. */
  start: string;
  /** Latest finished_at (or started_at if still running). */
  end: string;
  jobs: JobRow[];
  totalMs: number;
  quota: number;
  items: number;
  ok: number;
  skipped: number;
  errors: number;
  running: number;
}

/**
 * Groups jobs (any order) into runs: consecutive jobs less than 2 h apart are one run.
 * Returns most recent run first, jobs inside a run in execution order.
 */
export function groupRuns(jobs: JobRow[]): NightRun[] {
  const sorted = [...jobs].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const groups: JobRow[][] = [];
  let lastTs = -Infinity;
  for (const j of sorted) {
    const ts = new Date(j.started_at).getTime();
    if (ts - lastTs > RUN_GAP_MS || groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(j);
    lastTs = Math.max(lastTs, new Date(j.finished_at ?? j.started_at).getTime(), ts);
  }
  return groups.reverse().map(summarize);
}

function summarize(jobs: JobRow[]): NightRun {
  const start = jobs[0].started_at;
  let endTs = new Date(start).getTime();
  const run: NightRun = { start, end: start, jobs, totalMs: 0, quota: 0, items: 0, ok: 0, skipped: 0, errors: 0, running: 0 };
  for (const j of jobs) {
    endTs = Math.max(endTs, new Date(j.finished_at ?? j.started_at).getTime());
    run.quota += j.quota_used ?? 0;
    run.items += j.items_processed ?? 0;
    const s = jobState(j);
    if (s === 'ok') run.ok++;
    else if (s === 'skipped') run.skipped++;
    else if (s === 'error') run.errors++;
    else run.running++;
  }
  run.end = new Date(endTs).toISOString();
  run.totalMs = endTs - new Date(start).getTime();
  return run;
}

/** Most recent run that looks like the nightly (it starts with `user-channels`); manual relaunches are ignored. */
export function lastNightlyRun(runs: NightRun[]): NightRun | null {
  return runs.find((r) => r.jobs.some((j) => j.kind === 'user-channels')) ?? runs[0] ?? null;
}

export function nightlyDeadlineMin(): number {
  return parseInt(process.env.NIGHTLY_DEADLINE_MIN ?? '15', 10) || 15;
}

/** YouTube Data API daily ceiling (the soft limit stays below it). */
export const YT_DAILY_CAP = 10_000;

/** Cost hints for a manual relaunch, derived from the job history. */
export function relaunchCost(jobs: JobRow[], now = Date.now()) {
  const since = now - 24 * 3_600_000;
  const usedLast24h = jobs
    .filter((j) => new Date(j.started_at).getTime() >= since)
    .reduce((s, j) => s + (j.quota_used ?? 0), 0);
  const lastCollect = jobs.find((j) => j.kind === 'collect' && jobState(j) === 'ok' && (j.quota_used ?? 0) > 0);
  return { usedLast24h, collectEstimate: lastCollect?.quota_used ?? null, dailyCap: YT_DAILY_CAP };
}

/** True when no job started in the last 26 h (the nightly runs every 24 h). */
export function isRunOverdue(lastStart: string | null | undefined, now = Date.now()): boolean {
  if (!lastStart) return true;
  return now - new Date(lastStart).getTime() > 26 * 3_600_000;
}
