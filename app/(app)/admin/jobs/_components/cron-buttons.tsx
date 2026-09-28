'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  RefreshCw,
  Brain,
  Calculator,
  Bell,
  AlertTriangle,
} from 'lucide-react';
import { relaunchCron, testAlert } from '@/lib/actions/crons';

const cronButtons = [
  { kind: 'collect', label: 'Relancer collect', icon: RefreshCw },
  { kind: 'classify', label: 'Relancer classify', icon: Brain },
  { kind: 'score', label: 'Relancer score', icon: Calculator },
] as const;

export function CronButtons() {
  const [isPending, startTransition] = useTransition();
  const [relaunching, setRelaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  function handleRelaunch(kind: string) {
    const secret = prompt('CRON_SECRET :');
    if (!secret) return;
    setRelaunching(kind);
    setError(null);
    startTransition(async () => {
      const result = await relaunchCron(kind, secret);
      if (result.error) {
        setError(result.error);
      } else {
        toast.success(`Cron "${kind}" relancé.`);
      }
      setRelaunching(null);
    });
  }

  function handleTestAlert() {
    const secret = prompt('CRON_SECRET :');
    if (!secret) return;
    setSendingTest(true);
    startTransition(async () => {
      const result = await testAlert(secret);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Alerte envoyée (${result.method}).`);
      }
      setSendingTest(false);
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {cronButtons.map(({ kind, label, icon: Icon }) => (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            onClick={() => handleRelaunch(kind)}
            disabled={isPending}
          >
            <Icon className={relaunching === kind ? 'animate-spin' : ''} />
            {relaunching === kind ? 'Lancement\u2026' : label}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="border-warning/40 text-warning hover:bg-phase-1-soft"
          onClick={handleTestAlert}
          disabled={isPending}
        >
          <Bell />
          {sendingTest ? 'Envoi\u2026' : 'Alerte test'}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-3">
            <AlertTriangle className="size-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
