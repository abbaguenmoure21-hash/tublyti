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

/**
 * Reads every page of a query (PostgREST caps each response at 1,000 rows, silently).
 * `page(from, to)` must apply an ORDER BY that is total (ends with a unique column).
 * Stops at `maxRows` as a safety net. Returns the first error met, with the rows read so far.
 */
export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  maxRows = 50_000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: out, error };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data: out, error: null };
}
