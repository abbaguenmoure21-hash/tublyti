import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { createServiceClient } from '@/lib/supabase/server';
import { encryptionReady } from '@/lib/crypto/tokens';
import { ANALYTICS_SCOPES, GOOGLE_STATE_COOKIE, YT_SCOPE, googleEnabled, randomState, redirectUri, sign } from '@/lib/youtube/google-oauth';

/**
 * Envoie le client vers Google.
 * - par défaut : prouver qu'une chaîne lui appartient (lecture seule, accès révoqué aussitôt) ;
 * - mode=analytics&chaine=<id> : relier YouTube Analytics à une de ses chaînes (statistiques privées et revenus).
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const analytics = request.nextUrl.searchParams.get('mode') === 'analytics';
  const channelRowId = request.nextUrl.searchParams.get('chaine');
  if (analytics) {
    if (!googleEnabled() || !encryptionReady()) return NextResponse.redirect(new URL('/my-channel?analytics=indisponible', request.url));
    if (!channelRowId || !z.string().uuid().safeParse(channelRowId).success) return NextResponse.redirect(new URL('/my-channel', request.url));
    const { data: row } = await createServiceClient().from('user_channels').select('id').eq('id', channelRowId).eq('user_id', user.id).maybeSingle();
    if (!row) return NextResponse.redirect(new URL('/my-channel', request.url));
  } else if (!googleEnabled()) {
    return NextResponse.redirect(new URL('/settings?google=indisponible#chaines', request.url));
  }

  const state = randomState();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_OAUTH_CLIENT_ID!);
  url.searchParams.set('redirect_uri', redirectUri(request.nextUrl.origin));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', analytics ? ANALYTICS_SCOPES.join(' ') : YT_SCOPE);
  url.searchParams.set('access_type', analytics ? 'offline' : 'online');
  // « consent » garantit un jeton de rafraîchissement pour les statistiques.
  url.searchParams.set('prompt', analytics ? 'consent select_account' : 'select_account');
  url.searchParams.set('state', state);
  const back = analytics ? '/my-channel' : request.nextUrl.searchParams.get('retour') === 'bienvenue' ? '/bienvenue' : '/settings';

  const res = NextResponse.redirect(url.toString());
  res.cookies.set(GOOGLE_STATE_COOKIE, sign({ state, userId: user.id, back, mode: analytics ? 'analytics' : 'verify', channelRowId }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
