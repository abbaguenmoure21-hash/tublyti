import { SupabaseClient } from '@supabase/supabase-js';
import type { JobRecord, JobRunner } from './runner';

export class SupabaseJobRunner implements JobRunner {
  constructor(private readonly db: SupabaseClient) {}

  async start(kind: string): Promise<JobRecord> {
    const { data, error } = await this.db
      .from('jobs')
      .insert({ kind })
      .select()
      .single();

    if (error) throw new Error(`Failed to start job: ${error.message}`);

    return {
      id: data.id,
      kind: data.kind,
      startedAt: new Date(data.started_at),
      finishedAt: null,
      quotaUsed: 0,
      itemsProcessed: 0,
      error: null,
    };
  }

  async finish(
    id: string,
    result: { quotaUsed: number; itemsProcessed: number; error?: string },
  ): Promise<void> {
    const { error } = await this.db
      .from('jobs')
      .update({
        finished_at: new Date().toISOString(),
        quota_used: result.quotaUsed,
        items_processed: result.itemsProcessed,
        error: result.error ?? null,
      })
      .eq('id', id);

    if (error) throw new Error(`Failed to finish job: ${error.message}`);
  }

  async isLocked(kind: string): Promise<boolean> {
    const { data } = await this.db
      .from('settings')
      .select('value')
      .eq('key', `lock_${kind}`)
      .single();

    if (!data) return false;
    const lock = data.value as { locked: boolean; at: string };
    if (!lock.locked) return false;

    // Stale lock: if older than 10 minutes, consider it released
    const lockAge = Date.now() - new Date(lock.at).getTime();
    if (lockAge > 10 * 60 * 1000) return false;

    return true;
  }

  async acquireLock(kind: string): Promise<boolean> {
    if (await this.isLocked(kind)) return false;

    const { error } = await this.db.from('settings').upsert({
      key: `lock_${kind}`,
      value: { locked: true, at: new Date().toISOString() },
    });

    return !error;
  }

  async releaseLock(kind: string): Promise<void> {
    await this.db.from('settings').upsert({
      key: `lock_${kind}`,
      value: { locked: false, at: new Date().toISOString() },
    });
  }
}
