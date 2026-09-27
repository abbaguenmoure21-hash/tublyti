'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { signup } from './actions';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
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
      setError('Identifiants incorrects. Veuillez reessayer.');
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
      setError('Le mot de passe doit contenir au moins 6 caracteres.');
      setLoading(false);
      return;
    }

    const result = await signup(email, password);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setSuccess('Compte cree. Verifiez votre email pour confirmer, puis connectez-vous.');
    setMode('login');
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-accent/30 px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Zap className="w-6 h-6" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">TubLyTI</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Detectez les opportunites YouTube avant tout le monde
            </p>
          </div>
        </div>

        <Card className="border-border/50 shadow-xl shadow-primary/5">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {mode === 'login' ? 'Connexion' : 'Inscription'}
            </CardTitle>
            <CardDescription>
              {mode === 'login'
                ? 'Accedez a votre tableau de bord'
                : 'Creez votre compte TubLyTI'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={mode === 'login' ? handleLogin : handleSignup}
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
                />
              </div>
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
                />
              </div>

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
                className="w-full cursor-pointer"
                size="lg"
              >
                {loading
                  ? mode === 'login'
                    ? 'Connexion...'
                    : 'Inscription...'
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
                      onClick={() => {
                        setMode('signup');
                        setError(null);
                        setSuccess(null);
                      }}
                      className="text-primary font-medium hover:underline cursor-pointer"
                    >
                      S&apos;inscrire
                    </button>
                  </>
                ) : (
                  <>
                    Deja un compte ?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setError(null);
                        setSuccess(null);
                      }}
                      className="text-primary font-medium hover:underline cursor-pointer"
                    >
                      Se connecter
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
