import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QuotaLedger,
  QuotaSoftLimitReached,
  installQuotaMeter,
  pacificDay,
  ytRequestCost,
} from '@/lib/youtube/quota';
import { RealYouTubeClient } from '@/lib/youtube/client';

const YT = 'https://www.googleapis.com/youtube/v3';
let uninstall: (() => void) | null = null;
const realFetch = globalThis.fetch;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  globalThis.fetch = realFetch;
});

function stubNetwork(status = 200, body: unknown = { items: [] }) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe('quota ledger', () => {
  it('costs search.list 100 and other reads 1', () => {
    expect(ytRequestCost(`${YT}/search?part=snippet&q=x`)).toBe(100);
    expect(ytRequestCost(`${YT}/videos?id=a`)).toBe(1);
    expect(ytRequestCost(`${YT}/channelSections?channelId=a`)).toBe(1);
  });

  it('formats the Pacific day', () => {
    // 2026-03-10 05:00 UTC = 2026-03-09 in Los Angeles
    expect(pacificDay(new Date('2026-03-10T05:00:00Z'))).toBe('2026-03-09');
  });

  it('shares one counter between the client and raw fetch callers, and never exceeds the soft limit', async () => {
    const network = stubNetwork();
    const ledger = new QuotaLedger(1000);
    ledger.setBase(700); // already spent earlier today
    uninstall = installQuotaMeter(ledger);
    const yt = new RealYouTubeClient('k', 1000);

    ledger.setTask('collect');
    await yt.getChannels(['UC1']); // 1
    ledger.setTask('search');
    await fetch(`${YT}/search?part=snippet&q=a`); // 100
    await fetch(`${YT}/search?part=snippet&q=b`); // 100
    expect(ledger.total()).toBe(901);
    await expect(fetch(`${YT}/search?part=snippet&q=c`)).rejects.toThrow(QuotaSoftLimitReached);
    expect(yt.getQuotaUsed()).toBe(901);
    expect(ledger.taskUsage()).toEqual({ collect: 1, search: 200 });
    // The refused call never reached the network, and the client call was not charged twice.
    expect(network).toHaveBeenCalledTimes(3);
    expect(ledger.total()).toBeLessThanOrEqual(1000);
  });

  it('stops everything after a 403 quotaExceeded', async () => {
    const network = stubNetwork(403, { error: { errors: [{ reason: 'quotaExceeded' }] } });
    const ledger = new QuotaLedger(8000);
    uninstall = installQuotaMeter(ledger);
    await expect(fetch(`${YT}/channelSections?channelId=a`)).rejects.toThrow(QuotaSoftLimitReached);
    expect(ledger.exhausted).toBe(true);
    await expect(fetch(`${YT}/videos?id=a`)).rejects.toThrow(QuotaSoftLimitReached);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('does not touch other hosts', async () => {
    const network = stubNetwork();
    const ledger = new QuotaLedger(1);
    uninstall = installQuotaMeter(ledger);
    await fetch('https://hn.algolia.com/api/v1/search_by_date?query=x');
    expect(ledger.total()).toBe(0);
    expect(network).toHaveBeenCalledTimes(1);
  });
});
