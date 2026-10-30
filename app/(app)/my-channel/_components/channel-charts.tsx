'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { DailyChartProps, MonthlyChartProps } from './charts-recharts';
import { RefreshCw } from 'lucide-react';
import { disconnectAnalytics, refreshAnalytics, refreshChannelPublic } from '@/lib/actions/analytics';
import type { Period } from '@/lib/youtube/analytics';
import { buttonVariants } from '@/components/ui/button';

// recharts (~105 KB gz) loads on demand; the placeholders reserve the exact chart height (no layout shift).
export const DailyChart = dynamic<DailyChartProps>(() => import('./charts-recharts').then((m) => m.DailyChart), {
  ssr: false,
  loading: () => <div className="h-56 w-full" />,
});

export const MonthlyChart = dynamic<MonthlyChartProps>(() => import('./charts-recharts').then((m) => m.MonthlyChart), {
  ssr: false,
  loading: () => <div className="h-52 w-full" />,
});

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setMessage(null);
      const res = await fn();
      if (res.error) setMessage(res.error);
      router.refresh();
    });
  return { pending, message, run };
}

export function RefreshPublicButton({ id }: { id: string }) {
  const { pending, message, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => refreshChannelPublic(id))}
        className="elev-1 inline-flex h-9 items-center gap-2 rounded-[10px] bg-card px-3.5 text-sm font-medium disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} aria-hidden="true" />
        {pending ? 'Mise à jour…' : 'Mettre à jour'}
      </button>
      {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
    </div>
  );
}

export function AnalyticsControls({ id, period }: { id: string; period: Period }) {
  const { pending, message, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => refreshAnalytics(id, period))}
          className="inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-sm font-medium text-primary disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} aria-hidden="true" />
          Actualiser
        </button>
        {confirm ? (
          <>
            <button type="button" onClick={() => setConfirm(false)} className="inline-flex h-9 items-center rounded-[10px] px-3 text-sm font-medium text-muted-foreground">
              Annuler
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => disconnectAnalytics(id))}
              className={buttonVariants({ variant: 'destructive', size: 'lg' })}
            >
              Retirer l’accès
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="inline-flex h-9 items-center rounded-[10px] px-3 text-sm font-medium text-destructive">
            Déconnecter
          </button>
        )}
      </div>
      {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
    </div>
  );
}
