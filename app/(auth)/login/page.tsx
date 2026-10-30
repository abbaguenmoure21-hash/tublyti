'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PhaseBadge } from '@/components/tublyti/phase-badge';
import { safeNext } from '@/lib/safe-next';

type Mode = 'login' | 'forgot' | 'magic';

const inputClass =
  'h-11 w-full rounded-lg border border-input bg-card px-3.5 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring';

type AuthErrorLike = { status?: number; code?: string; name?: string } | null;

function isRateLimited(err: AuthErrorLike): boolean {
  return !!err && (err.status === 429 || err.code === 'over_email_send_rate_limit' || err.code === 'over_request_rate_limit');
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch failure
  const e = err as AuthErrorLike;
  return !!e && (e.name === 'AuthRetryableFetchError' || e.status === 0);
}

const RATE_LIMIT_MSG = 'Trop de tentatives. Réessaie dans quelques minutes.';
const NETWORK_MSG = 'Connexion impossible. Vérifie ta connexion internet.';
const LINK_ERROR_MSG = 'Ce lien a expiré ou a déjà servi. Demande un nouveau lien ci-dessous.';
// Same answer whether or not the address has an account (no account enumeration).
const MAGIC_SENT_MSG = 'Si un compte existe pour cette adresse, un lien vient de partir. Ouvre l’e-mail sur cet appareil pour te connecter.';
const RESET_SENT_MSG = 'Si un compte existe pour cette adresse, un lien pour choisir un nouveau mot de passe vient de partir.';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get('next');
  const linkError = searchParams.get('erreur') === 'lien';
  const initialMode: Mode = linkError ? 'magic' : searchParams.get('mode') === 'oubli' ? 'forgot' : 'login';

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(linkError ? LINK_ERROR_MSG : null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const focusEmailNext = useRef(false);

  // After a mode switch, move focus to the email field so keyboard and screen-reader users are not lost.
  useEffect(() => {
    if (!focusEmailNext.current) return;
    focusEmailNext.current = false;
    emailRef.current?.focus();
  });

  // Countdown before "Renvoyer" becomes available again.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function switchMode(nextMode: Mode) {
    focusEmailNext.current = true;
    setMode(nextMode);
    setError(null);
    setSuccess(null);
    setResendIn(0);
  }

  function changeAddress() {
    focusEmailNext.current = true;
    setSuccess(null);
    setResendIn(0);
  }

  async function send() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const supabase = createClient();
      const next = safeNext(rawNext, window.location.origin);

      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) {
          if (isRateLimited(authError)) setError(RATE_LIMIT_MSG);
          else if (isNetworkError(authError)) setError(NETWORK_MSG);
          else setError('E-mail ou mot de passe incorrect.');
          return;
        }
        router.replace(next);
        router.refresh();
        return;
      }

      if (mode === 'magic') {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (isRateLimited(otpError)) return setError(RATE_LIMIT_MSG);
        if (isNetworkError(otpError)) return setError(NETWORK_MSG);
        // Any other error (unknown address included) gets the same neutral answer.
        setSuccess(MAGIC_SENT_MSG);
        setResendIn(60);
        return;
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login/reset`,
      });
      if (isRateLimited(resetError)) return setError(RATE_LIMIT_MSG);
      if (isNetworkError(resetError)) return setError(NETWORK_MSG);
      setSuccess(RESET_SENT_MSG);
      setResendIn(60);
    } catch (err) {
      setError(isNetworkError(err) ? NETWORK_MSG : 'Une erreur est survenue. Réessaie dans un instant.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send();
  }

  const title = mode === 'login' ? 'Connexion' : mode === 'magic' ? 'Connexion par e-mail' : 'Mot de passe oublié';
  const subtitle =
    mode === 'login'
      ? 'Connecte-toi pour voir tes meilleurs sujets de la semaine.'
      : mode === 'magic'
        ? 'Reçois un lien par e-mail pour te connecter sans mot de passe.'
        : 'Reçois un lien par e-mail pour choisir un nouveau mot de passe.';
  const submitLabel = loading
    ? mode === 'login'
      ? 'Connexion…'
      : 'Envoi…'
    : mode === 'login'
      ? 'Se connecter'
      : 'Envoyer le lien';

  return (
    <div className="grid min-h-screen bg-card text-foreground lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-16 sm:py-10">
        <Link href="/" className="flex items-center gap-2.5 self-start text-foreground">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">T</span>
          <span className="text-lg font-semibold">TubLyTI</span>
        </Link>

        <div className="flex flex-1 items-center py-10">
          <form onSubmit={handleSubmit} className="flex w-full max-w-[400px] flex-col gap-5" noValidate={false}>
            <div className="flex flex-col gap-2">
              <h1 aria-live="polite" className="text-[30px] font-semibold tracking-[-0.02em]">
                {title}
              </h1>
              <p className="text-[15px] text-muted-foreground">{subtitle}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Adresse e-mail
              </label>
              <input
                ref={emailRef}
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="toi@exemple.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>

            {mode === 'login' && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium">
                    Mot de passe
                  </label>
                  <button type="button" onClick={() => switchMode('forgot')} className="text-sm font-medium text-primary hover:text-primary-ink">
                    Mot de passe oublié ?
                  </button>
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {success && (
              <div role="status" className="flex flex-col gap-2 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-foreground">
                <p>{success}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={loading || resendIn > 0}
                    className="font-medium text-primary hover:text-primary-ink disabled:cursor-not-allowed disabled:text-muted-foreground"
                  >
                    {resendIn > 0 ? `Renvoyer (dans ${resendIn} s)` : 'Renvoyer'}
                  </button>
                  <button type="button" onClick={changeAddress} className="font-medium text-primary hover:text-primary-ink">
                    Changer d’adresse
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 items-center justify-center rounded-lg bg-primary text-[15px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {submitLabel}
            </button>

            {mode === 'login' ? (
              <>
                <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  ou
                  <span className="h-px flex-1 bg-border" />
                </div>
                <button
                  type="button"
                  onClick={() => switchMode('magic')}
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-card text-[15px] font-medium hover:bg-muted"
                >
                  Recevoir un lien de connexion par e-mail
                </button>
              </>
            ) : (
              <button type="button" onClick={() => switchMode('login')} className="self-start text-sm font-medium text-primary hover:text-primary-ink">
                ← Retour à la connexion
              </button>
            )}

            <p className="text-sm text-muted-foreground">
              Pas encore d’accès ?{' '}
              <Link href="/liste-attente?source=connexion" className="font-medium text-primary hover:text-primary-ink">
                Rejoindre la liste d’attente
              </Link>
            </p>
          </form>
        </div>

        <span className="text-[13px] text-muted-foreground">© {new Date().getFullYear()} TubLyTI</span>
      </div>

      <aside className="hidden flex-col justify-center gap-6 border-l border-border bg-muted p-16 lg:flex" aria-label="Ce que tu retrouves dans TubLyTI">
        <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-primary-ink">Ce qui t’attend</span>
        <div className="flex max-w-[480px] flex-col gap-3.5 rounded-xl border border-border bg-card p-5 elev-1">
          <PhaseBadge phase={2} />
          <span className="text-lg font-semibold">Tes meilleurs sujets de la semaine</span>
          <span className="text-sm text-muted-foreground">Ceux que le public demande et que peu de chaînes traitent encore, classés par potentiel.</span>
        </div>
        <div className="ml-10 flex max-w-[480px] flex-col gap-3.5 rounded-xl border border-border bg-card p-5 elev-1">
          <PhaseBadge phase={1} />
          <span className="text-lg font-semibold">Les questions de tes spectateurs</span>
          <span className="text-sm text-muted-foreground">Les commentaires qui réclament une vidéo, avec la citation exacte et le nombre de likes.</span>
        </div>
        <p className="max-w-[480px] text-[15px] leading-relaxed text-muted-foreground">
          Ta liste est mise à jour chaque nuit, avec un résumé par e-mail le dimanche.
        </p>
      </aside>
    </div>
  );
}
