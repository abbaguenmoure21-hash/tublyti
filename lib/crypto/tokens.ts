import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Chiffrement des jetons Google (AES-256-GCM).
 * Clé : TOKEN_ENCRYPTION_KEY (32 octets en base64, ex. `openssl rand -base64 32`).
 */
function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY manquante');
  const buf = Buffer.from(raw, 'base64');
  // Une clé mal formée est ramenée à 32 octets plutôt que de tout bloquer.
  return buf.length === 32 ? buf : createHash('sha256').update(raw).digest();
}

export function encryptionReady(): boolean {
  return Boolean(process.env.TOKEN_ENCRYPTION_KEY);
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decrypt(token: string): string {
  const [v, iv, tag, data] = token.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Jeton chiffré invalide');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
