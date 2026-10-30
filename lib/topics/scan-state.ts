/**
 * Incremental orphan scans (attach, enrich-insufficient).
 * An orphan video already compared with the same set of topics gives the same answer:
 * only new videos (videos.attach_checked_at is null, migration 00033) are compared, unless the set
 * of candidate topics changed since the last full scan, or that scan is older than 7 days
 * (topic centroids drift as videos are attached).
 */
import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const FULL_RESCAN_DAYS = 7;

export function topicSignature(ids: string[]): string {
  return createHash('sha1').update([...ids].sort().join(',')).digest('hex');
}

interface ScanState {
  signature: string;
  fullAt: string;
}

export async function needsFullScan(db: SupabaseClient, key: string, signature: string): Promise<boolean> {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error || !data?.value) return true;
  const state = data.value as Partial<ScanState>;
  if (state.signature !== signature || !state.fullAt) return true;
  return Date.now() - new Date(state.fullAt).getTime() > FULL_RESCAN_DAYS * 86_400_000;
}

export async function saveFullScan(db: SupabaseClient, key: string, signature: string): Promise<void> {
  const value: ScanState = { signature, fullAt: new Date().toISOString() };
  const { error } = await db.from('settings').upsert({ key, value });
  if (error) console.error(`scan state ${key}: ${error.message}`);
}

/**
 * Per-topic incremental plan (attach). Compared with the topic ids of the last complete pass:
 * - nothing changed → 'incremental' (only never-compared videos);
 * - topics only added → 'added' (every orphan against the NEW topics only, never-compared ones against all);
 * - a topic removed (its videos may be orphans again), no state, or full pass > 7 days → 'full'.
 */
export type ScanPlan = { mode: 'full' } | { mode: 'incremental' } | { mode: 'added'; added: Set<string> };

interface TopicScanState {
  ids: string[];
  fullAt: string;
}

export function decideScan(state: Partial<TopicScanState> | null, ids: string[], now: number = Date.now()): ScanPlan {
  if (!state?.ids || !state.fullAt) return { mode: 'full' };
  if (now - new Date(state.fullAt).getTime() > FULL_RESCAN_DAYS * 86_400_000) return { mode: 'full' };
  const current = new Set(ids);
  const previous = new Set(state.ids);
  for (const id of previous) if (!current.has(id)) return { mode: 'full' };
  const added = new Set(ids.filter((id) => !previous.has(id)));
  return added.size === 0 ? { mode: 'incremental' } : { mode: 'added', added };
}

export async function loadTopicScanState(db: SupabaseClient, key: string): Promise<Partial<TopicScanState> | null> {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error || !data?.value) return null;
  return data.value as Partial<TopicScanState>;
}

/** Save after a complete pass; `full` resets the 7-day clock, an 'added' pass keeps the previous one. */
export async function saveTopicScanState(
  db: SupabaseClient,
  key: string,
  ids: string[],
  full: boolean,
  previous: Partial<TopicScanState> | null,
): Promise<void> {
  const value: TopicScanState = { ids: [...ids].sort(), fullAt: full || !previous?.fullAt ? new Date().toISOString() : previous.fullAt };
  const { error } = await db.from('settings').upsert({ key, value });
  if (error) console.error(`scan state ${key}: ${error.message}`);
}

export function isMissingColumn(message: string, column: string): boolean {
  return message.includes(column);
}

/** Mark compared videos (attach_checked_at = now), 200 ids per update. */
export async function markChecked(db: SupabaseClient, ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await db.from('videos').update({ attach_checked_at: now }).in('id', ids.slice(i, i + 200));
    if (error) {
      console.error(`attach_checked_at update: ${error.message}`);
      return;
    }
  }
}
