import { timingSafeCompare } from '@/lib/auth/timing-safe';

/** Minimum length accepted for CRON_SECRET: a shorter value is treated as absent. */
const MIN_SECRET_LENGTH = 16;

/**
 * Server-to-server calls (cron, internal routes) authenticated with CRON_SECRET.
 * Fails closed: no secret configured (or a too short one) → always false, so a missing
 * variable never turns into an accepted "Bearer undefined". Constant-time comparison.
 */
export function isCronAuthorized(authHeader: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH || !authHeader) return false;
  return timingSafeCompare(authHeader, `Bearer ${secret}`);
}

/** Convenience wrapper for route handlers. */
export function isCronRequest(req: Request): boolean {
  return isCronAuthorized(req.headers.get('authorization'));
}
