import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata = { title: 'Tâches de fond' };
import { Badge } from '@/components/ui/badge';
import {
  Settings,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { CronButtons } from './_components/cron-buttons';
import { jobLabel } from '@/lib/jobs/labels';

interface Job {
  id: string;
  kind: string;
  started_at: string;
  finished_at: string | null;
  quota_used: number;
  items_processed: number;
  error: string | null;
}

function formatDate(d: string | null) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function duration(start: string, end: string | null) {
  if (!end) return 'En cours\u2026';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function StatusBadge({ job }: { job: Job }) {
  if (job.error) {
    return (
      <Badge variant="destructive">
        <XCircle />
        Erreur
      </Badge>
    );
  }
  if (job.finished_at) {
    return (
      <Badge className="bg-phase-2-soft text-phase-2-ink">
        <CheckCircle />
        OK
      </Badge>
    );
  }
  return (
    <Badge className="bg-phase-1-soft text-phase-1-ink">
      <Clock />
      En cours
    </Badge>
  );
}

export default async function JobsPage() {
  // Page de la console (protégée par requireAdmin) : lecture avec la clé de service.
  const db = createServiceClient();
  const { data: jobs, error } = await db
    .from('jobs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Collecte</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Les tâches de nuit qui mettent à jour les données, et leur relance manuelle en cas de panne.
        </p>
      </div>

      {/* Boutons d&apos;action (composant client) */}
      <CronButtons />

      {/* Erreur de chargement */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-3">
            <XCircle className="size-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">
              Impossible de charger l&apos;historique des jobs : {error.message}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Contenu : vide ou tableau */}
      {!error && (!jobs || jobs.length === 0) ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Settings className="size-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              Aucune tâche enregistrée pour le moment.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Lance une tâche ci-dessus pour commencer.
            </p>
          </CardContent>
        </Card>
      ) : jobs && jobs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Historique des tâches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium rounded-tl-md">Type</th>
                    <th className="px-3 py-2 text-left font-medium">Début</th>
                    <th className="px-3 py-2 text-left font-medium">Durée</th>
                    <th className="px-3 py-2 text-left font-medium">Quota</th>
                    <th className="px-3 py-2 text-left font-medium">Items</th>
                    <th className="px-3 py-2 text-left font-medium">Statut</th>
                    <th className="px-3 py-2 text-left font-medium rounded-tr-md">Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {(jobs as Job[]).map((job) => (
                    <tr
                      key={job.id}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium">{jobLabel(job.kind)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {formatDate(job.started_at)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {duration(job.started_at, job.finished_at)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {job.quota_used.toLocaleString('fr-FR')}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">
                        {job.items_processed.toLocaleString('fr-FR')}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge job={job} />
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px]">
                        {job.error ? (
                          <span
                            className="text-xs text-destructive truncate block"
                            title={job.error}
                          >
                            {job.error}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{'\u2014'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
