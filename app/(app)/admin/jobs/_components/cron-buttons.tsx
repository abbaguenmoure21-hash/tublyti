'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { RefreshCw, Brain, Calculator, Bell, AlertTriangle } from 'lucide-react';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { relaunchCron, testAlert } from '@/lib/actions/crons';
import { jobLabel } from '@/lib/jobs/labels';

type Kind = 'collect' | 'classify' | 'score';

const cronButtons: { kind: Kind; label: string; confirm: string; icon: typeof RefreshCw }[] = [
  { kind: 'collect', label: 'Relancer la collecte', confirm: 'Relancer la collecte', icon: RefreshCw },
  { kind: 'classify', label: 'Relancer le classement des commentaires', confirm: 'Relancer le classement', icon: Brain },
  { kind: 'score', label: 'Relancer le calcul du potentiel', confirm: 'Relancer le calcul', icon: Calculator },
];

export interface CronCostInfo {
  /** Quota used by the last collect run (estimate for a relaunch), null if unknown. */
  collectEstimate: number | null;
  /** YouTube quota used over the last 24 h. */
  usedLast24h: number;
  /** YouTube daily quota ceiling. */
  dailyCap: number;
}

function costText(kind: Kind, cost: CronCostInfo) {
  const left = Math.max(0, cost.dailyCap - cost.usedLast24h).toLocaleString('fr-FR');
  if (kind === 'collect') {
    const est = cost.collectEstimate !== null ? `environ ${cost.collectEstimate.toLocaleString('fr-FR')} unités` : 'des unités';
    return `Elle utilise ${est} de quota YouTube (il reste environ ${left} unités sur les dernières 24 h). Elle dure au plus 4 minutes.`;
  }
  if (kind === 'classify') {
    return 'Il n’utilise pas de quota YouTube, mais consomme un peu de budget IA pour lire les nouveaux commentaires. Il dure au plus 4 minutes.';
  }
  return 'Il n’utilise ni quota YouTube ni budget IA : il recalcule le potentiel à partir des données déjà collectées.';
}

export function CronButtons({ cost }: { cost: CronCostInfo }) {
  const [isPending, startTransition] = useTransition();
  const [relaunching, setRelaunching] = useState<Kind | null>(null);
  const [asking, setAsking] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  function handleRelaunch(kind: Kind) {
    setAsking(null);
    setRelaunching(kind);
    setError(null);
    startTransition(async () => {
      const result = await relaunchCron(kind);
      if ('error' in result) {
        setError(result.error);
      } else {
        toast.success(`${jobLabel(kind)} relancé${kind === 'collect' ? 'e' : ''}`);
      }
      setRelaunching(null);
    });
  }

  function handleTestAlert() {
    setSendingTest(true);
    startTransition(async () => {
      const result = await testAlert();
      if ('error' in result) {
        toast.error(result.error);
      } else {
        toast.success(result.method === 'resend' ? 'Alerte de test envoyée par e-mail' : 'Alerte de test écrite dans les journaux du serveur (e-mail non configuré)');
      }
      setSendingTest(false);
    });
  }

  const current = cronButtons.find((b) => b.kind === asking);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {cronButtons.map(({ kind, label, icon: Icon }) => (
          <Button key={kind} variant="outline" size="sm" onClick={() => setAsking(kind)} disabled={isPending}>
            <Icon className={relaunching === kind ? 'animate-spin' : ''} aria-hidden="true" />
            {relaunching === kind ? 'Lancement…' : label}
          </Button>
        ))}
        <Button variant="outline" size="sm" onClick={handleTestAlert} disabled={isPending}>
          <Bell aria-hidden="true" />
          {sendingTest ? 'Envoi…' : 'Envoyer une alerte de test'}
        </Button>
      </div>

      {current && (
        <ConfirmDialog
          open={asking !== null}
          onOpenChange={(o) => !o && setAsking(null)}
          title={`${current.confirm} ?`}
          description={<p>{costText(current.kind, cost)}</p>}
          confirmLabel={current.confirm}
          onConfirm={() => handleRelaunch(current.kind)}
          pending={isPending}
        />
      )}

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </>
  );
}
