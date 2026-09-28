import { SupabaseClient } from '@supabase/supabase-js';
import type { JobRecord, JobRunner } from './runner';
import type { AlertSender } from '../email/alerts';

export class SupabaseJobRunner implements JobRunner {
  private alertSender: AlertSender | null = null;

  constructor(private readonly db: SupabaseClient) {}

  setAlertSender(sender: AlertSender): void {
    this.alertSender = sender;
  }

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

    // Send alert on cron failure
    if (result.error && this.alertSender) {
      // Get job kind from the DB
      const { data: job } = await this.db
        .from('jobs')
        .select('kind')
        .eq('id', id)
        .single();

      const kind = job?.kind ?? 'unknown';
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tublyti.vercel.app';

      await this.alertSender.send({
        kind: 'cron_failed',
        subject: `Cron ${kind} en echec`,
        body: `Le cron « ${kind} » a echoue avec l'erreur :\n\n${result.error}`,
        actionUrl: `${baseUrl}/admin/jobs`,
        actionLabel: 'Voir les jobs',
      });
    }
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
    // Atomic lock acquisition: single upsert that only succeeds if not currently locked
    // This eliminates the TOCTOU race between isLocked() and upsert()
    const now = new Date().toISOString();
    const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const key = `lock_${kind}`;

    // Try to insert a new lock (if key doesn't exist) or update if unlocked/stale
    const { data, error } = await this.db.rpc('acquire_job_lock', {
      p_key: key,
      p_now: now,
      p_stale_cutoff: staleCutoff,
    });

    if (error) {
      // Fallback: RPC not yet deployed, use old logic with isLocked guard
      if (await this.isLocked(kind)) return false;
      const { error: upsertErr } = await this.db.from('settings').upsert({
        key,
        value: { locked: true, at: now },
      });
      return !upsertErr;
    }

    return data === true;
  }

  async releaseLock(kind: string): Promise<void> {
    await this.db.from('settings').upsert({
      key: `lock_${kind}`,
      value: { locked: false, at: new Date().toISOString() },
    });
  }
}
