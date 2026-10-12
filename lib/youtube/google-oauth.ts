import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Connexion Google, uniquement pour prouver qu'une chaîne YouTube appartient au client.
 * Portée « youtube.readonly », accès ponctuel : le jeton Google n'est jamais enregistré
 * et il est révoqué dès que la liste des chaînes est lue.
 */
export const GOOGLE_STATE_COOKIE = 'tublyti-google-state';
export const GOOGLE_CHANNELS_COOKIE = 'tublyti-google-channels';
export const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
/** Statistiques privées (vues, durée, audience) et revenus. */
export const ANALYTICS_SCOPES = [
  YT_SCOPE,
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
];

export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function redirectUri(origin: string): string {
  // Adresse publique si elle est renseignée (Vercel), sinon celle de la requête (localhost). Jamais de « / » final.
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || origin).replace(/\/+$/, '');
  return `${base}/api/youtube/callback`;
}

export function randomState(): string {
  return randomBytes(24).toString('base64url');
}

function key(): string {
  const k = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!k) throw new Error('GOOGLE_OAUTH_CLIENT_SECRET manquant');
  return k;
}

/** Signe un petit contenu JSON pour un cookie (impossible à modifier côté navigateur). */
export function sign(payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', key()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', key()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

/** Chaînes trouvées sur le compte Google, gardées 15 minutes dans un cookie signé. */
export interface GoogleChannels {
  userId: string;
  expiresAt: number;
  channels: { id: string; title: string; handle: string | null; thumbnailUrl: string | null; subscriberCount: number | null; videoCount: number }[];
}
