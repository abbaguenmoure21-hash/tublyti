'use client';

import { useActionState, useId } from 'react';
import { joinWaitlist, type WaitlistState } from '@/app/actions/waitlist';

const initial: WaitlistState = { status: 'idle' };

export function WaitlistForm({
  source,
  tone = 'light',
}: {
  source: string;
  tone?: 'light' | 'dark';
}) {
  const [state, action, pending] = useActionState(joinWaitlist, initial);
  const id = useId();
  const dark = tone === 'dark';

  if (state.status === 'success') {
    return (
      <p
        role="status"
        className={`rounded-xl px-4 py-3 text-[15px] font-medium ${
          dark ? 'bg-white/10 text-white' : 'bg-phase-2-soft text-phase-2-ink'
        }`}
      >
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="flex w-full max-w-[520px] flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <label htmlFor={`${id}-email`} className="sr-only">
          Adresse e-mail
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="ton@email.com"
          aria-invalid={state.status === 'error'}
          aria-describedby={state.status === 'error' ? `${id}-err` : undefined}
          className={`h-12 min-w-0 flex-[1_1_240px] rounded-[10px] border px-4 text-base outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
            dark
              ? 'border-white/20 bg-white/5 text-white placeholder:text-white/50 focus-visible:ring-offset-[#141822]'
              : 'border-input bg-card text-foreground placeholder:text-muted-foreground'
          }`}
        />
        {/* Champ piège anti-robot, invisible pour les humains */}
        <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <input type="hidden" name="source" value={source} />
        <button
          type="submit"
          disabled={pending}
          className={`h-12 shrink-0 rounded-[10px] px-5 text-base font-medium transition-opacity disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
            dark ? 'bg-[#8b88f5] text-[#0d0f16]' : 'bg-primary text-primary-foreground hover:opacity-90'
          }`}
        >
          {pending ? 'Inscription…' : "Rejoindre la liste d'attente"}
        </button>
      </div>
      {state.status === 'error' && (
        <p id={`${id}-err`} role="alert" className={`text-sm ${dark ? 'text-red-300' : 'text-destructive'}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
