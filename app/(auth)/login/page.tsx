'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { signup } from './actions';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function FloatingCube({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`absolute shape-3d ${className ?? ''}`} style={style}>
      <div
        className="w-16 h-16 relative"
        style={{
          transformStyle: 'preserve-3d',
          animation: 'spin-slow 20s linear infinite',
        }}
      >
        {/* Front */}
        <div className="face w-16 h-16 rounded-lg" style={{ transform: 'translateZ(32px)' }} />
        {/* Back */}
        <div className="face w-16 h-16 rounded-lg" style={{ transform: 'rotateY(180deg) translateZ(32px)' }} />
        {/* Left */}
        <div className="face w-16 h-16 rounded-lg" style={{ transform: 'rotateY(-90deg) translateZ(32px)' }} />
        {/* Right */}
        <div className="face w-16 h-16 rounded-lg" style={{ transform: 'rotateY(90deg) translateZ(32px)' }} />
        {/* Top */}
        <div className="face w-16 h-16 rounded-lg" style={{ transform: 'rotateX(90deg) translateZ(32px)' }} />
        {/* Bottom */}
        <div className="face w-16 h-16 rounded-lg" style={{ transform: 'rotateX(-90deg) translateZ(32px)' }} />
      </div>
    </div>
  );
}

function FloatingRing({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`absolute ${className ?? ''}`} style={style}>
      <div
        className="w-24 h-24 rounded-full border-2 border-primary/20"
        style={{
          animation: 'float-medium 8s ease-in-out infinite',
          boxShadow: '0 0 30px oklch(0.488 0.243 264.376 / 0.1), inset 0 0 30px oklch(0.488 0.243 264.376 / 0.05)',
        }}
      />
    </div>
  );
}

function FloatingDiamond({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`absolute ${className ?? ''}`} style={style}>
      <div
        className="w-12 h-12 rounded-md border border-primary/15 bg-primary/5 backdrop-blur-sm"
        style={{
          animation: 'float-fast 5s ease-in-out infinite',
          transform: 'rotate(45deg)',
        }}
      />
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError('Identifiants incorrects. Veuillez réessayer.');
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.');
      setLoading(false);
      return;
    }

    const result = await signup(email, password);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setSuccess('Compte créé. Vérifiez votre email pour confirmer, puis connectez-vous.');
    setMode('login');
    setLoading(false);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login/reset`,
    });

    if (resetError) {
      setError('Impossible d\u2019envoyer le lien. Vérifiez votre adresse email.');
      setLoading(false);
      return;
    }

    setSuccess('Un lien de réinitialisation a été envoyé à votre adresse email.');
    setLoading(false);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Animated gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, oklch(0.98 0.002 270) 0%, oklch(0.95 0.03 264) 30%, oklch(0.97 0.02 300) 60%, oklch(0.98 0.002 270) 100%)',
          backgroundSize: '400% 400%',
          animation: 'gradient-shift 15s ease infinite',
        }}
      />

      {/* Gradient orbs */}
      <div
        className="gradient-orb absolute -top-32 -left-32 w-96 h-96"
        style={{ background: 'oklch(0.488 0.243 264.376 / 0.3)' }}
      />
      <div
        className="gradient-orb absolute -bottom-48 -right-48 w-[500px] h-[500px]"
        style={{ background: 'oklch(0.60 0.20 300 / 0.25)', animationDelay: '3s' }}
      />
      <div
        className="gradient-orb absolute top-1/3 right-1/4 w-64 h-64"
        style={{ background: 'oklch(0.65 0.18 160 / 0.15)', animationDelay: '1.5s' }}
      />

      {/* Floating 3D shapes */}
      <FloatingCube
        className="hidden md:block"
        style={{ top: '12%', left: '8%', animation: 'float-slow 10s ease-in-out infinite' }}
      />
      <FloatingCube
        className="hidden md:block"
        style={{ bottom: '18%', right: '10%', animation: 'float-slow 12s ease-in-out infinite', animationDelay: '2s' }}
      />
      <FloatingRing
        className="hidden md:block"
        style={{ top: '20%', right: '15%' }}
      />
      <FloatingRing
        className="hidden md:block"
        style={{ bottom: '25%', left: '12%', animationDelay: '4s' }}
      />
      <FloatingDiamond
        className="hidden sm:block"
        style={{ top: '30%', left: '25%' }}
      />
      <FloatingDiamond
        className="hidden sm:block"
        style={{ bottom: '35%', right: '22%', animationDelay: '2.5s' }}
      />
      <FloatingDiamond
        className="hidden sm:block"
        style={{ top: '65%', left: '5%', animationDelay: '1s' }}
      />

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(oklch(0.488 0.243 264.376 / 0.03) 1px, transparent 1px),
            linear-gradient(90deg, oklch(0.488 0.243 264.376 / 0.03) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Content */}
      <div className="relative z-10 w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div
            className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-primary-foreground"
            style={{
              boxShadow: '0 0 40px oklch(0.488 0.243 264.376 / 0.4), 0 8px 32px oklch(0.488 0.243 264.376 / 0.25)',
              animation: 'float-fast 4s ease-in-out infinite',
            }}
          >
            <Zap className="w-7 h-7" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">TubLyTI</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Détectez les opportunités YouTube avant tout le monde
            </p>
          </div>
        </div>

        <Card className="glass border-border/30 shadow-2xl shadow-primary/10">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {mode === 'login' ? 'Connexion' : mode === 'signup' ? 'Inscription' : 'Mot de passe oublié'}
            </CardTitle>
            <CardDescription>
              {mode === 'login'
                ? 'Accédez à votre tableau de bord'
                : mode === 'signup'
                  ? 'Créez votre compte TubLyTI'
                  : 'Entrez votre email pour recevoir un lien de réinitialisation'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={mode === 'login' ? handleLogin : mode === 'signup' ? handleSignup : handleForgotPassword}
              className="space-y-4"
            >
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="vous@exemple.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-background/50 backdrop-blur-sm"
                />
              </div>
              {mode !== 'forgot' && (
                <div className="space-y-2">
                  <label htmlFor="password" className="text-sm font-medium">
                    Mot de passe
                  </label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="bg-background/50 backdrop-blur-sm"
                  />
                </div>
              )}

              {mode === 'login' && (
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); setError(null); setSuccess(null); }}
                    className="text-xs text-muted-foreground hover:text-primary cursor-pointer"
                  >
                    Mot de passe oublié ?
                  </button>
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2 text-sm text-green-700">
                  {success}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full cursor-pointer relative overflow-hidden"
                size="lg"
                style={{
                  boxShadow: '0 4px 20px oklch(0.488 0.243 264.376 / 0.3)',
                }}
              >
                {loading
                  ? mode === 'forgot'
                    ? 'Envoi...'
                    : mode === 'login'
                      ? 'Connexion...'
                      : 'Inscription...'
                  : mode === 'forgot'
                    ? 'Envoyer le lien'
                    : mode === 'login'
                      ? 'Se connecter'
                      : "S'inscrire"}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">
                {mode === 'login' ? (
                  <>
                    Pas de compte ?{' '}
                    <button
                      type="button"
                      onClick={() => { setMode('signup'); setError(null); setSuccess(null); }}
                      className="text-primary font-medium hover:underline cursor-pointer"
                    >
                      S&apos;inscrire
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { setMode('login'); setError(null); setSuccess(null); }}
                      className="text-primary font-medium hover:underline cursor-pointer"
                    >
                      Retour à la connexion
                    </button>
                  </>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
