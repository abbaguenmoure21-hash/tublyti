import type { SupabaseClient } from '@supabase/supabase-js';

export class QuotaSoftLimitReached extends Error {
  constructor(used: number, limit: number, reason?: string) {
    super(reason ?? `YouTube quota soft limit reached: ${used}/${limit}`);
    this.name = 'QuotaSoftLimitReached';
  }
}

export function getQuotaSoftLimit(): number {
  const n = parseInt(process.env.YT_QUOTA_SOFT_LIMIT ?? '8000', 10);
  return Number.isFinite(n) && n > 0 ? n : 8000;
}

// ── Pacific day (YouTube resets the daily quota at midnight America/Los_Angeles) ──
export function pacificDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export const YT_DATA_API_PREFIX = 'https://www.googleapis.com/youtube/v3/';

/** Data API v3 cost of one request (search.list = 100, every read we use = 1). */
export function ytRequestCost(url: string): number {
  const path = url.slice(YT_DATA_API_PREFIX.length).split('?')[0] ?? '';
  return path.startsWith('search') ? 100 : 1;
}

/**
 * Single process-wide YouTube quota counter.
 * Every Data API request of the process goes through `spend()` (RealYouTubeClient directly,
 * every other module through the metered `fetch` installed by `installQuotaMeter`).
 * `base` = units already spent earlier in the same Pacific day (persisted ledger).
 */
export class QuotaLedger {
  private base = 0;
  private run = 0;
  private readonly byTask = new Map<string, number>();
  private readonly unflushed = new Map<string, number>();
  private task = 'other';
  exhausted = false;

  constructor(readonly softLimit: number = getQuotaSoftLimit()) {}

  setBase(units: number): void {
    this.base = Math.max(0, units);
  }

  setTask(task: string): void {
    this.task = task;
  }

  /** Charge `units` before a request; throws once the soft limit (or the real daily quota) is reached. */
  spend(units: number, task: string = this.task): void {
    if (this.exhausted) {
      throw new QuotaSoftLimitReached(this.total(), this.softLimit, 'YouTube daily quota exhausted (quotaExceeded)');
    }
    if (this.total() + units > this.softLimit) {
      throw new QuotaSoftLimitReached(this.total() + units, this.softLimit);
    }
    this.run += units;
    this.byTask.set(task, (this.byTask.get(task) ?? 0) + units);
    this.unflushed.set(task, (this.unflushed.get(task) ?? 0) + units);
  }

  canSpend(units: number): boolean {
    return !this.exhausted && this.total() + units <= this.softLimit;
  }

  /** Units spent by this process. */
  runUsed(): number {
    return this.run;
  }

  /** Units spent today (Pacific), this process included. */
  total(): number {
    return this.base + this.run;
  }

  taskUsage(): Record<string, number> {
    return Object.fromEntries(this.byTask);
  }

  takeUnflushed(): Array<[string, number]> {
    const out = [...this.unflushed.entries()].filter(([, u]) => u > 0);
    this.unflushed.clear();
    return out;
  }

  restoreUnflushed(entries: Array<[string, number]>): void {
    for (const [t, u] of entries) this.unflushed.set(t, (this.unflushed.get(t) ?? 0) + u);
  }
}

let activeLedger: QuotaLedger | null = null;

export function getActiveLedger(): QuotaLedger | null {
  return activeLedger;
}

/** Header RealYouTubeClient sets on requests it already charged (stripped before the request leaves). */
export const METERED_HEADER = 'x-tublyti-quota-metered';

function isQuotaExhaustedBody(text: string): boolean {
  return /quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(text);
}

/**
 * Route every googleapis YouTube Data API request of the process through `ledger`:
 * - charges requests not already charged by RealYouTubeClient (search = 100, other = 1),
 *   and refuses them (QuotaSoftLimitReached) once the soft limit is reached;
 * - a 403 quotaExceeded marks the ledger exhausted: every later request fails fast, without network.
 * Idempotent; returns an uninstall function (tests).
 */
export function installQuotaMeter(ledger: QuotaLedger): () => void {
  const original = globalThis.fetch;
  activeLedger = ledger;
  const metered: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith(YT_DATA_API_PREFIX)) return original(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (headers.has(METERED_HEADER)) {
      headers.delete(METERED_HEADER);
    } else {
      ledger.spend(ytRequestCost(url));
    }
    const res = await original(input instanceof Request ? new Request(input, { headers }) : input, { ...init, headers });
    if (res.status === 403) {
      const text = await res.clone().text().catch(() => '');
      if (isQuotaExhaustedBody(text)) {
        ledger.exhausted = true;
        throw new QuotaSoftLimitReached(ledger.total(), ledger.softLimit, `YouTube daily quota exhausted (403): ${text.slice(0, 200)}`);
      }
    }
    return res;
  };
  globalThis.fetch = metered;
  return () => {
    globalThis.fetch = original;
    if (activeLedger === ledger) activeLedger = null;
  };
}

// ── Persistent ledger (table yt_quota_ledger, migration 00033) ─────────────────
// Every function falls back silently-but-logged when the migration is not applied yet.
let ledgerTableMissing = false;

export async function loadQuotaSpentToday(db: SupabaseClient, day: string = pacificDay()): Promise<number> {
  const { data, error } = await db.from('yt_quota_ledger').select('units').eq('day_pt', day);
  if (error) {
    ledgerTableMissing = true;
    console.warn(`  [quota] yt_quota_ledger unavailable (${error.message}) — starting from 0 (apply migration 00033)`);
    return 0;
  }
  return (data ?? []).reduce((s, r) => s + ((r as { units: number | null }).units ?? 0), 0);
}

export async function flushQuotaLedger(db: SupabaseClient, ledger: QuotaLedger, day: string = pacificDay()): Promise<void> {
  if (ledgerTableMissing) return;
  const entries = ledger.takeUnflushed();
  for (let i = 0; i < entries.length; i++) {
    const [task, units] = entries[i]!;
    const { error } = await db.rpc('increment_yt_quota', { p_day: day, p_task: task, p_units: units });
    if (error) {
      ledgerTableMissing = true;
      ledger.restoreUnflushed(entries.slice(i));
      console.warn(`  [quota] increment_yt_quota unavailable (${error.message}) — ledger not persisted`);
      return;
    }
  }
}
