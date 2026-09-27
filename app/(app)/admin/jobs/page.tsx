'use client';

import { useEffect, useState, useCallback } from 'react';

interface Job {
  id: string;
  kind: string;
  started_at: string;
  finished_at: string | null;
  quota_used: number;
  items_processed: number;
  error: string | null;
}

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

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Admin — Jobs</h1>
        <div className="flex flex-wrap gap-2">
          {['collect', 'classify', 'score'].map((kind) => (
            <button
              key={kind}
              onClick={() => handleRelaunch(kind)}
              disabled={relaunching === kind}
              className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 cursor-pointer"
            >
              {relaunching === kind ? '...' : `Relancer ${kind}`}
            </button>
          ))}
          <button
            onClick={handleTestAlert}
            disabled={sendingTest}
            className="bg-amber-500 text-white rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 cursor-pointer"
          >
            {sendingTest ? '...' : 'Envoyer une alerte test'}
          </button>
        </div>
      </div>

      {testResult && (
        <p className="mt-2 text-sm text-amber-600">{testResult}</p>
      )}

      {error && <p className="text-destructive mt-2 text-sm">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground mt-6">Chargement…</p>
      ) : jobs.length === 0 ? (
        <p className="text-muted-foreground mt-6">Aucun job exécuté pour le moment.</p>
      ) : (
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 font-medium">Début</th>
              <th className="pb-2 font-medium">Durée</th>
              <th className="pb-2 font-medium">Quota</th>
              <th className="pb-2 font-medium">Items</th>
              <th className="pb-2 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b">
                <td className="py-2 font-medium">{job.kind}</td>
                <td className="py-2">{formatDate(job.started_at)}</td>
                <td className="py-2">{duration(job.started_at, job.finished_at)}</td>
                <td className="py-2">{job.quota_used.toLocaleString('fr-FR')}</td>
                <td className="py-2">{job.items_processed.toLocaleString('fr-FR')}</td>
                <td className="py-2">
                  {job.error ? (
                    <span className="text-destructive" title={job.error}>
                      Erreur
                    </span>
                  ) : job.finished_at ? (
                    <span className="text-green-600">OK</span>
                  ) : (
                    <span className="text-yellow-600">En cours</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
