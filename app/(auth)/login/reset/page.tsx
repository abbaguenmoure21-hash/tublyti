'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Status = 'checking' | 'ready' | 'invalid';

const inputClass =
  'h-11 w-full rounded-lg border border-input bg-card px-3.5 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30';

const primaryButtonClass =
  'inline-flex h-11 items-center justify-center rounded-lg bg-primary text-[15px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    // The recovery link opens a session (code exchanged by the browser client on load).
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) setStatus('ready');
    });

    // getSession waits for the URL code exchange: no session means the link expired or was opened elsewhere.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (active) setStatus((s) => (s === 'ready' ? s : session ? 'ready' : 'invalid'));
      })
      .catch(() => {
        if (active) setStatus((s) => (s === 'ready' ? s : 'invalid'));
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => {
      router.replace('/sujets');
      router.refresh();
    }, 2000);
    return () => clearTimeout(t);
  }, [success, router]);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne sont pas identiques.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError('Impossible de changer le mot de passe. Réessaie ou demande un nouveau lien.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Connexion impossible. Vérifie ta connexion internet.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-card px-6 py-8 text-foreground sm:px-16 sm:py-10">
      <Link href="/" className="flex items-center gap-2.5 self-start text-foreground">
        <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">T</span>
        <span className="text-lg font-semibold">TubLyTI</span>
      </Link>

      <div className="flex flex-1 items-center py-10">
        <div className="flex w-full max-w-[400px] flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h1 className="text-[30px] font-semibold tracking-[-0.02em]">
              {status === 'invalid' ? 'Lien expiré' : 'Nouveau mot de passe'}
            </h1>
            <p className="text-[15px] text-muted-foreground">
              {status === 'invalid'
                ? 'Ce lien a expiré, a déjà servi ou a été ouvert sur un autre appareil.'
                : 'Choisis un nouveau mot de passe pour ton compte.'}
            </p>
          </div>

          {status === 'checking' && (
            <div className="flex flex-col gap-5" aria-busy="true" aria-label="Vérification du lien">
              <div className="h-11 animate-pulse rounded-lg bg-muted" />
              <div className="h-11 animate-pulse rounded-lg bg-muted" />
              <div className="h-11 animate-pulse rounded-lg bg-muted" />
            </div>
          )}

          {status === 'invalid' && (
            <Link href="/login" className={primaryButtonClass}>
              Demander un nouveau lien
            </Link>
          )}

          {status === 'ready' && success && (
            <div role="status" className="flex flex-col gap-2 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-foreground">
              <p>Mot de passe changé. Tu vas arriver sur tes sujets…</p>
              <Link href="/sujets" className="self-start font-medium text-primary hover:text-primary-ink">
                Continuer
              </Link>
            </div>
          )}

          {status === 'ready' && !success && (
            <form onSubmit={handleReset} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-sm font-medium">
                  Nouveau mot de passe
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm" className="text-sm font-medium">
                  Confirme le mot de passe
                </label>
                <input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>

              {error && (
                <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <button type="submit" disabled={loading} className={primaryButtonClass}>
                {loading ? 'Enregistrement…' : 'Changer le mot de passe'}
              </button>
            </form>
          )}

          <Link href="/login" className="self-start text-sm font-medium text-primary hover:text-primary-ink">
            ← Retour à la connexion
          </Link>
        </div>
      </div>

      <span className="text-[13px] text-muted-foreground">© {new Date().getFullYear()} TubLyTI</span>
    </div>
  );
}
