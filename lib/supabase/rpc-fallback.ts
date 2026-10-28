import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Read RPCs added by migration 00031 are applied by hand. Until they exist, callers fall back
 * to the previous query path. These helpers detect "function does not exist" and remember it
 * for a few minutes so we do not pay a failing round-trip on every request.
 */

const MISSING_TTL_MS = 10 * 60_000;
const missingUntil = new Map<string, number>();

export function isMissingFunction(error: Pick<PostgrestError, 'code'> | null | undefined): boolean {
  return !!error && (error.code === 'PGRST202' || error.code === '42883');
}

export function rpcKnownMissing(name: string): boolean {
  const until = missingUntil.get(name);
  if (until === undefined) return false;
  if (Date.now() > until) {
    missingUntil.delete(name);
    return false;
  }
  return true;
}

export function markRpcMissing(name: string): void {
  missingUntil.set(name, Date.now() + MISSING_TTL_MS);
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
