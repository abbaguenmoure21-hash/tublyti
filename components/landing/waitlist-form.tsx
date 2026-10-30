'use client';

import { useActionState, useEffect, useId, useRef } from 'react';
import { joinWaitlist, type WaitlistState } from '@/app/actions/waitlist';

const initial: WaitlistState = { status: 'idle' };

/**
 * Waitlist sign-up. Colours come only from tokens: on a dark section, wrap the form in a
 * `dark` scope (the landing's final section does) and the same classes render the dark theme.
 * `tone` is kept for API compatibility.
 */
export function WaitlistForm({
  source,
}: {
  source: string;
  tone?: 'light' | 'dark';
}) {
  const [state, action, pending] = useActionState(joinWaitlist, initial);
  const id = useId();
  const successRef = useRef<HTMLParagraphElement>(null);

  // The form is replaced by the confirmation: move focus to it so it is read and scrolled into view.
  useEffect(() => {
    if (state.status === 'success') successRef.current?.focus();
  }, [state.status]);

  if (state.status === 'success') {
    return (
      <p
        ref={successRef}
        tabIndex={-1}
        role="status"
        className="rounded-xl border border-success/25 bg-success/10 px-4 py-3 text-[15px] font-medium text-foreground outline-none"
      >
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="relative flex w-full max-w-[520px] flex-col gap-2">
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
          className="h-12 min-w-0 flex-[1_1_240px] rounded-lg border border-input bg-card px-4 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        {/* Anti-bot trap: off-screen (not display:none, which many bots skip) with a non-semantic name autofill ignores. */}
        <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
          <label htmlFor={`${id}-hp`}>Ne pas remplir</label>
          <input id={`${id}-hp`} type="text" name="website_hp" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
        <input type="hidden" name="source" value={source} />
        <button
          type="submit"
          disabled={pending}
          className="h-12 shrink-0 rounded-lg bg-primary px-5 text-base font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {pending ? 'Inscription…' : "Rejoindre la liste d'attente"}
        </button>
      </div>
      {state.status === 'error' && (
        <p id={`${id}-err`} role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
