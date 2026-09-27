'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Settings,
  RefreshCw,
  Brain,
  Calculator,
  Bell,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';

interface Job {
  id: string;
  kind: string;
  started_at: string;
  finished_at: string | null;
  quota_used: number;
  items_processed: number;
  error: string | null;
}

const cronButtons = [
  { kind: 'collect', label: 'Relancer collect', icon: RefreshCw },
  { kind: 'classify', label: 'Relancer classify', icon: Brain },
  { kind: 'score', label: 'Relancer score', icon: Calculator },
] as const;

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relaunching, setRelaunching] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) throw new Error('Impossible de charger les jobs');
      const data = await res.json();
      setJobs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  async function handleRelaunch(kind: string) {
    setRelaunching(kind);
    setError(null);
    try {
      const res = await fetch(`/api/cron/${kind}`, {
        headers: { Authorization: `Bearer ${prompt('CRON_SECRET :')}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du lancement');
    } finally {
      setRelaunching(null);
    }
  }

  function formatDate(d: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function duration(start: string, end: string | null) {
    if (!end) return 'En cours…';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
  }

  async function handleTestAlert() {
    setSendingTest(true);
    setTestResult(null);
    try {
      const secret = prompt('CRON_SECRET :');
      if (!secret) { setSendingTest(false); return; }
      const res = await fetch('/api/alerts/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTestResult(`Alerte envoyee (${data.method})`);
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSendingTest(false);
    }
  }

  function renderStatusBadge(job: Job) {
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
        <Badge className="bg-green-500/10 text-green-700 border-green-200">
          <CheckCircle />
          OK
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 border-amber-200">
        <Clock />
        En cours
      </Badge>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Administration</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestion des jobs et crons
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {cronButtons.map(({ kind, label, icon: Icon }) => (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            onClick={() => handleRelaunch(kind)}
            disabled={relaunching === kind}
          >
            <Icon className={relaunching === kind ? 'animate-spin' : ''} />
            {relaunching === kind ? 'Lancement...' : label}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="border-amber-300 text-amber-700 hover:bg-amber-50"
          onClick={handleTestAlert}
          disabled={sendingTest}
        >
          <Bell />
          {sendingTest ? 'Envoi...' : 'Alerte test'}
        </Button>
      </div>

      {/* Test result feedback */}
      {testResult && (
        <p className="text-sm text-amber-600 font-medium">{testResult}</p>
      )}

      {/* Error feedback */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertTriangle className="size-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Content: loading / empty / table */}
      {loading ? (
        <Card>
          <CardHeader>
            <CardTitle>Historique des jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Settings className="size-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              Aucun job execute pour le moment.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Lancez un cron ci-dessus pour commencer.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Historique des jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium rounded-tl-md">Type</th>
                    <th className="px-3 py-2 text-left font-medium">Debut</th>
                    <th className="px-3 py-2 text-left font-medium">Duree</th>
                    <th className="px-3 py-2 text-left font-medium">Quota</th>
                    <th className="px-3 py-2 text-left font-medium">Items</th>
                    <th className="px-3 py-2 text-left font-medium">Statut</th>
                    <th className="px-3 py-2 text-left font-medium rounded-tr-md">Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium">{job.kind}</td>
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
                        {renderStatusBadge(job)}
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
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
