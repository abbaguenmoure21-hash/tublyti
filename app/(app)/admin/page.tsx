import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { jobLabel } from '@/lib/jobs/labels';

export const metadata = { title: 'Console d’admin' };


function ago(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'il y a moins d’une heure';
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} jours`;
}

/** Console d'admin · vue d'ensemble : ce qui demande une action, puis l'état de la collecte. */
export default async function AdminPage() {
  await requireAdmin();
  const db = createServiceClient();
  const [proposed, candidates, channels, profiles, noChannel, waitlist, jobs] = await Promise.all([
    db.from('topics').select('id', { count: 'exact', head: true }).eq('status', 'proposed'),
    db.from('candidate_channels').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('channels').select('id', { count: 'exact', head: true }),
    db.from('profiles').select('user_id', { count: 'exact', head: true }).eq('role', 'client'),
    db.from('user_channels').select('user_id'),
    db.from('waitlist').select('id', { count: 'exact', head: true }),
    db.from('jobs').select('id, kind, started_at, finished_at, error, quota_used').order('started_at', { ascending: false }).limit(8),
  ]);

  const withChannel = new Set(((noChannel.data ?? []) as { user_id: string }[]).map((r) => r.user_id)).size;
  const todo = [
    { n: proposed.count ?? 0, label: 'sujets proposés à valider', href: '/admin/sujets' },
    { n: candidates.count ?? 0, label: 'chaînes candidates à examiner', href: '/channels/candidates' },
    { n: waitlist.count ?? 0, label: 'inscriptions sur la liste d’attente', href: '/admin/attente' },
  ];
  const stats = [
    { label: 'Clients', value: profiles.count ?? 0, hint: `${withChannel} compte${withChannel > 1 ? 's' : ''} avec au moins une chaîne` },
    { label: 'Chaînes analysées', value: channels.count ?? 0, hint: 'Catalogue commun à tous les clients' },
  ];
  const jobRows = (jobs.data ?? []) as { id: string; kind: string; started_at: string; finished_at: string | null; error: string | null; quota_used: number | null }[];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">Console d’admin</h1>
        <p className="text-[15px] text-muted-foreground">Le fonctionnement de TubLyTI : collecte, catalogue, validation et comptes clients. Les clients ne voient pas cet espace.</p>
      </header>

      <section aria-labelledby="a-faire" className="flex flex-col gap-3">
        <h2 id="a-faire" className="text-lg font-semibold">À traiter</h2>
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {todo.map((t) => (
            <li key={t.href} className="border-b border-muted last:border-b-0">
              <Link href={t.href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/60">
                <span className={`min-w-10 text-xl font-semibold tabular-nums ${t.n ? 'text-foreground' : 'text-muted-foreground'}`}>{t.n}</span>
                <span className="flex-1 text-sm">{t.label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="chiffres" className="grid gap-3 sm:grid-cols-2">
        <h2 id="chiffres" className="sr-only">Chiffres clés</h2>
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-4">
            <span className="text-[13px] text-muted-foreground">{s.label}</span>
            <span className="text-2xl font-semibold tabular-nums">{s.value}</span>
            <span className="text-xs text-muted-foreground">{s.hint}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="collecte" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="collecte" className="text-lg font-semibold">Dernières tâches</h2>
          <Link href="/admin/jobs" className="text-sm font-medium text-primary">Tout voir</Link>
        </div>
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {jobRows.length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground">Aucune tâche enregistrée.</li>}
          {jobRows.map((j) => {
            const state = j.error ? 'Échec' : j.finished_at ? 'Terminée' : 'En cours';
            const tone = j.error ? 'text-destructive' : j.finished_at ? 'text-phase-2-ink' : 'text-phase-1-ink';
            return (
              <li key={j.id} className="flex items-center gap-3 border-b border-muted px-4 py-3 text-sm last:border-b-0">
                <span className="flex-1">
                  <span className="font-medium">{jobLabel(j.kind)}</span>
                  <span className="text-muted-foreground"> · {ago(j.started_at)}</span>
                  {j.error && <span className="mt-0.5 block truncate text-xs text-destructive">{j.error}</span>}
                </span>
                <span className={`text-[13px] font-medium ${tone}`}>{state}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
