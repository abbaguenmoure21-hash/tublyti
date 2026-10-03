import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Échange le code PKCE envoyé par Supabase (lien de connexion par e-mail) contre une session.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/sujets';
  // On n'accepte qu'un chemin interne pour éviter toute redirection ouverte.
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/sujets';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?erreur=lien`);
}
