'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PhaseBadge } from '@/components/tublyti/phase-badge';

type Mode = 'login' | 'forgot' | 'magic';

const inputClass =
  'h-11 w-full rounded-lg border border-input bg-card px-3.5 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    const supabase = createClient();

    if (mode === 'login') {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError('E-mail ou mot de passe incorrect.');
        setLoading(false);
        return;
      }
      router.push('/sujets');
      router.refresh();
      return;
    }

    if (mode === 'magic') {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback?next=/sujets` },
      });
      setLoading(false);
      if (otpError) {
        setError("Impossible d'envoyer le lien. Vérifie que ce compte existe.");
        return;
      }
      setSuccess('Lien envoyé. Ouvre l’e-mail sur cet appareil pour te connecter.');
      return;
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login/reset`,
    });
    setLoading(false);
    if (resetError) {
      setError("Impossible d'envoyer le lien. Vérifie ton adresse e-mail.");
      return;
    }
    setSuccess('Un lien de réinitialisation vient de partir vers ta boîte mail.');
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
              <h1 className="text-[30px] font-semibold tracking-[-0.02em]">{title}</h1>
              <p className="text-[15px] text-muted-foreground">{subtitle}</p>
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Adresse e-mail
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="toi@exemple.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </label>

            {mode === 'login' && (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="flex items-center justify-between">
                  Mot de passe
                  <button type="button" onClick={() => switchMode('forgot')} className="text-sm font-medium text-primary hover:text-primary-ink">
                    Mot de passe oublié ?
                  </button>
                </span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
              </label>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {success && (
              <p role="status" className="rounded-lg bg-phase-2-soft px-3 py-2 text-sm text-phase-2-ink">
                {success}
              </p>
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
              <Link href="/#liste" className="font-medium text-primary hover:text-primary-ink">
                Rejoindre la liste d’attente
              </Link>
            </p>
          </form>
        </div>

        <span className="text-[13px] text-muted-foreground">© {new Date().getFullYear()} TubLyTI</span>
      </div>

      <aside className="hidden flex-col justify-center gap-6 border-l border-border bg-muted p-16 lg:flex" aria-label="Ce que tu retrouves dans TubLyTI">
        <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-primary-ink">Ce qui t’attend</span>
        <div className="flex max-w-[480px] flex-col gap-3.5 rounded-[10px] border border-border bg-card p-5 shadow-sm">
          <PhaseBadge phase={2} />
          <span className="text-lg font-semibold">Tes meilleurs sujets de la semaine</span>
          <span className="text-sm text-muted-foreground">Ceux que le public demande et que peu de chaînes traitent encore, classés par potentiel.</span>
        </div>
        <div className="ml-10 flex max-w-[480px] flex-col gap-3.5 rounded-[10px] border border-border bg-card p-5 shadow-sm">
          <PhaseBadge phase={1} />
          <span className="text-lg font-semibold">Les questions de tes spectateurs</span>
          <span className="text-sm text-muted-foreground">Les commentaires qui réclament une vidéo, avec la citation exacte et le nombre de likes.</span>
        </div>
        <p className="max-w-[480px] text-[15px] leading-relaxed text-muted-foreground">
          Ta liste est mise à jour chaque nuit.
        </p>
      </aside>
    </div>
  );
}
