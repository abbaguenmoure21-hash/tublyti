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

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin — Jobs</h1>
        <div className="flex gap-2">
          {['collect', 'classify', 'score'].map((kind) => (
            <button
              key={kind}
              onClick={() => handleRelaunch(kind)}
              disabled={relaunching === kind}
              className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {relaunching === kind ? '…' : `Relancer ${kind}`}
            </button>
          ))}
        </div>
      </div>

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
