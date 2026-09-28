import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison using crypto.timingSafeEqual.
 * Returns false for different-length strings without leaking length info
 * beyond the fact that lengths differ.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');

  if (bufA.byteLength !== bufB.byteLength) return false;

  return timingSafeEqual(bufA, bufB);
}
