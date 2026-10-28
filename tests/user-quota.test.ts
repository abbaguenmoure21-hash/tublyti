import { beforeEach, describe, expect, it } from 'vitest';
import { consumeUserQuota, quotaBucket, resetMemoryQuotas, USER_QUOTAS, type QuotaDb } from '@/lib/auth/user-quota';

/** In-memory imitation of the consume_user_quota RPC. */
function rpcDb(): QuotaDb & { calls: number } {
  const counts = new Map<string, number>();
  const db = {
    calls: 0,
    async rpc(_fn: 'consume_user_quota', a: { p_user_id: string; p_action: string; p_bucket: string; p_limit: number }) {
      db.calls++;
      const key = `${a.p_user_id}|${a.p_action}|${a.p_bucket}`;
      const used = counts.get(key) ?? 0;
      if (used >= a.p_limit) return { data: null, error: null };
      counts.set(key, used + 1);
      return { data: used + 1, error: null };
    },
  };
  return db;
}

const client = { id: 'u1', role: 'client' };
const now = new Date('2026-10-28T14:05:00Z');

describe('consumeUserQuota', () => {
  beforeEach(() => resetMemoryQuotas());

  it('allows up to the cap, then refuses the (N+1)th call', async () => {
    const db = rpcDb();
    const limit = USER_QUOTAS.channel_lookup.limit;
    for (let i = 0; i < limit; i++) expect(await consumeUserQuota(db, client, 'channel_lookup', now)).toBe(true);
    expect(await consumeUserQuota(db, client, 'channel_lookup', now)).toBe(false);
  });

  it('starts a new window in the next hour / day', async () => {
    expect(quotaBucket('hour', now)).toBe('2026-10-28T14');
    expect(quotaBucket('day', now)).toBe('2026-10-28');
  });

  it('does not cap admins and does not call the database for them', async () => {
    const db = rpcDb();
    expect(await consumeUserQuota(db, { id: 'a', role: 'admin' }, 'video_upload', now)).toBe(true);
    expect(db.calls).toBe(0);
  });

  it('fails closed on an unexpected database error', async () => {
    const db: QuotaDb = { rpc: async () => ({ data: null, error: { code: '57014' } }) };
    expect(await consumeUserQuota(db, client, 'link_saturation', now)).toBe(false);
  });

  it('falls back to an in-memory cap before the migration is applied', async () => {
    const db: QuotaDb = { rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) };
    const limit = USER_QUOTAS.video_upload.limit;
    for (let i = 0; i < limit; i++) expect(await consumeUserQuota(db, client, 'video_upload', now)).toBe(true);
    expect(await consumeUserQuota(db, client, 'video_upload', now)).toBe(false);
  });
});
