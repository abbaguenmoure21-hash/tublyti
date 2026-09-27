import { describe, it, expect } from 'vitest';
import { FakeYouTubeClient } from '@/lib/youtube/fake-client';
import { QuotaSoftLimitReached } from '@/lib/youtube/quota';
import { parseDuration } from '@/lib/youtube/client';

describe('YouTubeClient quota counting', () => {
  it('increments quota on each API call', async () => {
    const client = new FakeYouTubeClient(8000);
    expect(client.getQuotaUsed()).toBe(0);

    await client.getChannels(['UC123']);
    expect(client.getQuotaUsed()).toBe(1);

    await client.getPlaylistItems('UU123');
    expect(client.getQuotaUsed()).toBe(2);

    await client.getVideos(['v1', 'v2']);
    expect(client.getQuotaUsed()).toBe(3);

    await client.getVideoSnapshots(['v1']);
    expect(client.getQuotaUsed()).toBe(4);

    await client.getCommentThreads('v1');
    expect(client.getQuotaUsed()).toBe(5);
  });

  it('throws QuotaSoftLimitReached when limit is hit', async () => {
    const client = new FakeYouTubeClient(3); // very low limit

    await client.getChannels(['UC1']); // 1
    await client.getPlaylistItems('UU1'); // 2

    await expect(client.getVideos(['v1'])).rejects.toThrow(QuotaSoftLimitReached);
    expect(client.getQuotaUsed()).toBe(3);
  });

  it('throws QuotaSoftLimitReached exactly at the limit', async () => {
    const client = new FakeYouTubeClient(1);

    // First call should throw because after incrementing quota reaches the limit
    await expect(client.getChannels(['UC1'])).rejects.toThrow(QuotaSoftLimitReached);
  });

  it('counts resolveHandles calls', async () => {
    const client = new FakeYouTubeClient(8000);
    await client.resolveHandles(['handle1', 'handle2']);
    expect(client.getQuotaUsed()).toBe(2); // 1 per handle
  });
});

describe('parseDuration', () => {
  it('parses hours, minutes, seconds', () => {
    expect(parseDuration('PT1H2M3S')).toBe(3723);
  });

  it('parses minutes only', () => {
    expect(parseDuration('PT15M')).toBe(900);
  });

  it('parses seconds only', () => {
    expect(parseDuration('PT30S')).toBe(30);
  });

  it('parses hours and minutes', () => {
    expect(parseDuration('PT2H30M')).toBe(9000);
  });

  it('returns 0 for invalid input', () => {
    expect(parseDuration('')).toBe(0);
    expect(parseDuration('invalid')).toBe(0);
  });
});

describe('graceful stop on quota', () => {
  it('stops processing after QuotaSoftLimitReached and preserves data', async () => {
    const client = new FakeYouTubeClient(4);
    const processed: string[] = [];
    const batches = [['a', 'b'], ['c', 'd'], ['e', 'f']];

    let stoppedByQuota = false;

    try {
      for (const batch of batches) {
        const channels = await client.getChannels(batch);
        for (const ch of channels) {
          processed.push(ch.id);
        }
        // Simulate playlist fetch
        await client.getPlaylistItems(`UU${batch[0]}`);
      }
    } catch (err) {
      if (err instanceof QuotaSoftLimitReached) {
        stoppedByQuota = true;
      }
    }

    // Should have processed some items before stopping
    expect(processed.length).toBeGreaterThan(0);
    expect(stoppedByQuota).toBe(true);
    // Quota should be at or above the limit
    expect(client.getQuotaUsed()).toBeGreaterThanOrEqual(4);
  });
});
