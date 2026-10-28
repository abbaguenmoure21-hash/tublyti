import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Monthly AI budget (settings.ai_spend_YYYY_MM), shared by every AI caller.
 *
 * Writes go through the atomic RPC `ai_budget_add` (migration 00034). While the
 * migration is not applied yet, we fall back to the old read-then-write so the
 * app keeps working (non-atomic, but no worse than before).
 *
 * Usage for a paid call:
 *   const r = await reserveAiBudget(db, estUsd);   // refuses if over the cap
 *   if (!r.ok) → show "budget reached"
 *   ... call the API ...
 *   await settleAiBudget(db, r, actualUsd);        // adjusts reserved → actual (0 on failure)
 */

export function aiMonthKey(d: Date = new Date()): string {
  return `ai_spend_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function aiBudgetLimit(): number {
  const n = Number(process.env.AI_BUDGET_USD ?? 30);
  return Number.isFinite(n) ? n : 30;
}

export async function aiSpentThisMonth(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from('settings').select('value').eq('key', aiMonthKey()).maybeSingle();
  if (error) throw new Error(`Lecture du budget IA impossible : ${error.message}`);
  return typeof data?.value === 'number' ? data.value : Number(data?.value ?? 0) || 0;
}

export async function aiBudgetLeft(db: SupabaseClient): Promise<number> {
  return aiBudgetLimit() - (await aiSpentThisMonth(db));
}

function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === 'PGRST202' || err.code === '42883' || /could not find the function|ai_budget_add/i.test(err.message ?? '');
}

/**
 * Atomically adds `deltaUsd` to this month's counter. With `limitUsd`, a positive
 * delta is refused when it would exceed the limit: returns null and nothing changes.
 * Returns the new total otherwise.
 */
export async function addAiSpend(db: SupabaseClient, deltaUsd: number, limitUsd?: number): Promise<number | null> {
  if (!Number.isFinite(deltaUsd) || deltaUsd === 0) {
    const spent = await aiSpentThisMonth(db);
    return limitUsd !== undefined && deltaUsd > 0 && spent + deltaUsd > limitUsd ? null : spent;
  }
  const key = aiMonthKey();
  const { data, error } = await db.rpc('ai_budget_add', {
    p_key: key,
    p_delta: deltaUsd,
    p_limit: limitUsd ?? null,
  });
  if (!error) return data === null || data === undefined ? null : Number(data);
  if (!isMissingFunction(error)) throw new Error(`Mise à jour du budget IA impossible : ${error.message}`);

  // Fallback (migration 00034 not applied yet): read then write.
  const spent = await aiSpentThisMonth(db);
  if (limitUsd !== undefined && deltaUsd > 0 && spent + deltaUsd > limitUsd) return null;
  const next = Math.max(0, spent + deltaUsd);
  const { error: upErr } = await db.from('settings').upsert({ key, value: next });
  if (upErr) throw new Error(`Mise à jour du budget IA impossible : ${upErr.message}`);
  return next;
}

export interface AiReservation {
  ok: boolean;
  reservedUsd: number;
  /** Budget left before the reservation (for messages). */
  remainingUsd: number;
}

/** Reserves `estUsd` under the monthly cap. ok=false means the call must not be made. */
export async function reserveAiBudget(db: SupabaseClient, estUsd: number): Promise<AiReservation> {
  const est = Math.max(0, estUsd);
  const limit = aiBudgetLimit();
  if (est === 0) {
    const left = limit - (await aiSpentThisMonth(db));
    return { ok: left > 0, reservedUsd: 0, remainingUsd: left };
  }
  const total = await addAiSpend(db, est, limit);
  if (total === null) {
    const left = limit - (await aiSpentThisMonth(db).catch(() => limit));
    return { ok: false, reservedUsd: 0, remainingUsd: left };
  }
  return { ok: true, reservedUsd: est, remainingUsd: limit - (total - est) };
}

/** Replaces the reserved amount by the real cost (use actualUsd = 0 when nothing was billed). */
export async function settleAiBudget(db: SupabaseClient, reservation: AiReservation, actualUsd: number): Promise<void> {
  const delta = Math.max(0, actualUsd) - reservation.reservedUsd;
  if (Math.abs(delta) < 1e-12) return;
  await addAiSpend(db, delta);
}
