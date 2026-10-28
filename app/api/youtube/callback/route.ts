import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { createServiceClient } from '@/lib/supabase/server';
import { ensureReachJob } from '@/lib/youtube/reporting';
import { encrypt } from '@/lib/crypto/tokens';
import {
  GOOGLE_CHANNELS_COOKIE,
  GOOGLE_STATE_COOKIE,
  redirectUri,
  sign,
  verify,
  type GoogleChannels,
} from '@/lib/youtube/google-oauth';

/**
 * Retour de Google : lit les chaînes du compte choisi, révoque aussitôt l'accès,
 * puis renvoie le client sur Réglages pour choisir la thématique de chaque chaîne.
 */
export async function GET(request: NextRequest) {
  // Every exit drops the one-time state cookie (no reuse within its 10 min lifetime).
  const fail = (reason: string, back = '/settings') => {
    const res = NextResponse.redirect(new URL(`${back}?google=${reason}#chaines`, request.url));
    res.cookies.delete(GOOGLE_STATE_COOKIE);
    return res;
  };

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const saved = verify<{ state: string; userId: string; back: string; mode?: 'verify' | 'analytics'; channelRowId?: string | null }>(
    request.cookies.get(GOOGLE_STATE_COOKIE)?.value,
  );
  const back = saved?.back === '/bienvenue' ? '/bienvenue' : saved?.back === '/my-channel' ? '/my-channel' : '/settings';
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  if (request.nextUrl.searchParams.get('error')) return fail('annule', back);
  if (!saved || !code || !state || saved.state !== state || saved.userId !== user.id) return fail('expire', back);

  // Échange du code contre un jeton d'accès temporaire
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri(request.nextUrl.origin),
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!tokenRes) return fail('erreur', back);
  const token = (await tokenRes.json().catch(() => null)) as { access_token?: string; refresh_token?: string; scope?: string } | null;
  if (!tokenRes.ok || !token?.access_token) return fail('erreur', back);

  if (saved.mode === 'analytics' && saved.channelRowId) {
    return connectAnalytics(request, user.id, saved.channelRowId, token);
  }

  // Chaînes du compte Google choisi (y compris un compte de marque sélectionné à l'écran Google)
  const chRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true&maxResults=50',
    { headers: { Authorization: `Bearer ${token.access_token}` }, cache: 'no-store', signal: AbortSignal.timeout(10_000) },
  ).catch(() => null);
  const data = chRes ? ((await chRes.json().catch(() => null)) as { items?: Record<string, unknown>[] } | null) : null;

  // On ne garde pas l'accès Google : révocation immédiate.
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.access_token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);

  const channels: GoogleChannels['channels'] = (data?.items ?? []).map((item) => {
    const sn = item.snippet as { title: string; customUrl?: string; thumbnails?: Record<string, { url?: string }> };
    const st = item.statistics as { subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
    return {
      id: item.id as string,
      title: sn.title,
      handle: sn.customUrl ?? null,
      thumbnailUrl: sn.thumbnails?.default?.url ?? null,
      subscriberCount: st.hiddenSubscriberCount ? null : Number(st.subscriberCount ?? 0),
      videoCount: Number(st.videoCount ?? 0),
    };
  });
  if (!chRes?.ok) return fail('erreur', back);
  if (!channels.length) return fail('aucune', back);

  const payload: GoogleChannels = { userId: user.id, expiresAt: Date.now() + 15 * 60_000, channels: channels.slice(0, 10) };
  const res = NextResponse.redirect(new URL(`${back}?google=ok#chaines`, request.url));
  res.cookies.set(GOOGLE_CHANNELS_COOKIE, sign(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 900,
  });
  res.cookies.delete(GOOGLE_STATE_COOKIE);
  return res;
}

/**
 * Relie YouTube Analytics à une chaîne du client : on vérifie que le compte Google choisi
 * possède bien cette chaîne, puis on garde le jeton de rafraîchissement, chiffré.
 */
async function connectAnalytics(
  request: NextRequest,
  userId: string,
  channelRowId: string,
  token: { access_token?: string; refresh_token?: string; scope?: string },
) {
  const go = (status: string) => {
    const res = NextResponse.redirect(new URL(`/my-channel?analytics=${status}`, request.url));
    res.cookies.delete(GOOGLE_STATE_COOKIE);
    return res;
  };
  const revoke = () =>
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.refresh_token ?? token.access_token ?? '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);

  const db = createServiceClient();
  const { data: row } = await db
    .from('user_channels')
    .select('id, youtube_channel_id, verified_at')
    .eq('id', channelRowId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!row?.youtube_channel_id) {
    await revoke();
    return go('erreur');
  }

  const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=50', {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const data = chRes ? ((await chRes.json().catch(() => null)) as { items?: { id: string }[] } | null) : null;
  if (!data?.items?.some((c) => c.id === row.youtube_channel_id)) {
    await revoke();
    return go('autre-chaine');
  }
  if (!token.refresh_token) {
    // Access granted but unusable: revoke it rather than leaving it active on Google's side.
    await revoke();
    return go('erreur');
  }

  const scopes = (token.scope ?? '').split(' ').filter(Boolean);
  const { error } = await db.from('user_channel_tokens').upsert({
    user_channel_id: row.id,
    user_id: userId,
    refresh_token_enc: encrypt(token.refresh_token),
    scopes,
    granted_at: new Date().toISOString(),
    last_error: null,
  });
  if (error) {
    await revoke();
    return go(error.code === '42P01' ? 'migration' : 'erreur');
  }
  // Google vient de prouver la propriété : la chaîne est vérifiée si elle ne l'était pas.
  if (!row.verified_at) await db.from('user_channels').update({ verified_at: new Date().toISOString() }).eq('id', row.id);
  await db.from('channel_analytics').delete().eq('user_channel_id', row.id);
  // Impressions et CTR des miniatures : la tâche de rapport quotidien est créée tout de suite (premier fichier sous 48 h).
  if (token.access_token) await ensureReachJob(db, row.id, token.access_token).catch(() => undefined);
  return go(scopes.some((sc) => sc.endsWith('yt-analytics-monetary.readonly')) ? 'ok' : 'ok-sans-revenus');
}
