import { CheckCircle, Clock, XCircle, AlertTriangle, Loader } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  jobState,
  formatDuration,
  formatNightDate,
  formatWhen,
  isRunOverdue,
  YT_DAILY_CAP,
  type JobRow,
  type NightRun,
} from '@/lib/admin/job-status';

export function JobStatusBadge({ job }: { job: JobRow }) {
  const state = jobState(job);
  if (state === 'skipped') {
    return (
      <Badge className="bg-muted text-muted-foreground" title="Plus de temps pour cette étape cette nuit. Elle reprend la nuit suivante.">
        <Clock aria-hidden="true" />
        Sautée
      </Badge>
    );
  }
  if (state === 'error') {
    return (
      <Badge variant="destructive">
        <XCircle aria-hidden="true" />
        Erreur
      </Badge>
    );
  }
  if (state === 'ok') {
    return (
      <Badge className="bg-phase-2-soft text-phase-2-ink">
        <CheckCircle aria-hidden="true" />
        Terminée
      </Badge>
    );
  }
  return (
    <Badge className="bg-phase-1-soft text-phase-1-ink">
      <Loader aria-hidden="true" />
      En cours
    </Badge>
  );
}

interface NightSummaryProps {
  run: NightRun | null;
  /** Nightly time budget in minutes (NIGHTLY_DEADLINE_MIN). */
  deadlineMin: number;
  /** YouTube quota soft limit (YT_QUOTA_SOFT_LIMIT). */
  quotaLimit: number;
}

/** "Last night" banner: overall state, total duration, quota and step counts in one glance. */
export function NightSummary({ run, deadlineMin, quotaLimit }: NightSummaryProps) {
  const overdue = isRunOverdue(run?.start);

  if (!run) {
    return (
      <section aria-label="Dernière collecte" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-4">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-destructive">Aucune collecte enregistrée</p>
          <p className="text-sm text-muted-foreground">La collecte de nuit n’a encore laissé aucune trace. Vérifie qu’elle est bien programmée.</p>
        </div>
      </section>
    );
  }

  const tone = run.errors > 0 ? 'error' : run.running > 0 ? 'running' : run.skipped > 0 ? 'skipped' : 'ok';
  const headline =
    tone === 'error'
      ? `${run.errors} étape${run.errors > 1 ? 's' : ''} en erreur`
      : tone === 'running'
        ? 'Collecte en cours'
        : tone === 'skipped'
          ? `Terminée · ${run.skipped} étape${run.skipped > 1 ? 's' : ''} sautée${run.skipped > 1 ? 's' : ''} faute de temps`
          : 'Tout s’est bien passé';
  const Icon = tone === 'error' ? XCircle : tone === 'ok' ? CheckCircle : Clock;
  const iconTone = tone === 'error' ? 'text-destructive' : tone === 'ok' ? 'text-phase-2-ink' : 'text-muted-foreground';
  const quotaTone = run.quota > YT_DAILY_CAP ? 'text-destructive' : run.quota > quotaLimit ? 'text-phase-1-ink' : '';
  const overBudget = run.totalMs > deadlineMin * 60_000;

  return (
    <section aria-label="Dernière collecte" className="flex flex-col gap-3">
      {overdue && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-semibold text-destructive">La collecte n’a pas tourné cette nuit.</span>{' '}
            <span className="text-muted-foreground">Dernière exécution : {formatWhen(run.start)}.</span>
          </p>
        </div>
      )}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-4 py-4 elev-1">
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 size-5 shrink-0 ${iconTone}`} aria-hidden="true" />
          <div className="flex flex-col gap-0.5">
            <p className="text-[13px] text-muted-foreground">Nuit du {formatNightDate(run.start)}</p>
            <p className="text-base font-semibold">{headline}</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Durée totale</dt>
            <dd className={`text-sm font-medium tabular-nums ${overBudget ? 'text-phase-1-ink' : ''}`}>
              {formatDuration(run.totalMs)} <span className="text-muted-foreground">sur {deadlineMin} min</span>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Quota YouTube</dt>
            <dd className={`text-sm font-medium tabular-nums ${quotaTone}`}>
              {run.quota.toLocaleString('fr-FR')} <span className="text-muted-foreground">/ {quotaLimit.toLocaleString('fr-FR')} unités</span>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Étapes</dt>
            <dd className="text-sm font-medium tabular-nums">
              {run.ok} terminée{run.ok > 1 ? 's' : ''}
              {run.skipped > 0 && <span className="text-muted-foreground"> · {run.skipped} sautée{run.skipped > 1 ? 's' : ''}</span>}
              {run.errors > 0 && <span className="text-destructive"> · {run.errors} erreur{run.errors > 1 ? 's' : ''}</span>}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{run.running > 0 ? 'Commencée' : 'Fin'}</dt>
            <dd className="text-sm font-medium tabular-nums">{formatWhen(run.running > 0 ? run.start : run.end)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
