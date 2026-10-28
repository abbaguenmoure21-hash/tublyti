import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { needsFullScan, topicSignature } from '@/lib/topics/scan-state';

function settingsDb(value: unknown): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe('incremental orphan scan', () => {
  const sig = topicSignature(['b', 'a']);

  it('signature ignores order', () => {
    expect(topicSignature(['a', 'b'])).toBe(sig);
    expect(topicSignature(['a', 'c'])).not.toBe(sig);
  });

  it('full scan on first run, after a topic change, or after 7 days', async () => {
    expect(await needsFullScan(settingsDb(undefined), 'k', sig)).toBe(true);
    expect(await needsFullScan(settingsDb({ signature: 'other', fullAt: new Date().toISOString() }), 'k', sig)).toBe(true);
    expect(await needsFullScan(settingsDb({ signature: sig, fullAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }), 'k', sig)).toBe(true);
  });

  it('incremental the next night when nothing changed', async () => {
    expect(await needsFullScan(settingsDb({ signature: sig, fullAt: new Date(Date.now() - 86_400_000).toISOString() }), 'k', sig)).toBe(false);
  });
});
