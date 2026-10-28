import { describe, expect, it } from 'vitest';
import { baselineBefore, channelContextAt, topicScoreBefore, viewsAt, type ChannelVideo } from '@/lib/predictor/context';
import { FEATURES, vectorize } from '@/lib/predictor/model';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

// One video every 3 days, 7-day views growing slowly.
const history: ChannelVideo[] = Array.from({ length: 20 }, (_, i) => ({ id: `v${i}`, publishedMs: T0 + i * 3 * DAY, views7d: 1000 + i * 10 }));

describe('predictor context (no look-ahead)', () => {
  it('ignores videos whose 7-day mark is after t', () => {
    const t = history[10].publishedMs;
    // Videos 8 and 9 (published 6 and 3 days before) are not 7 days old yet.
    const ctx = channelContextAt(history, t);
    expect(ctx.latestSourceMs).toBeLessThanOrEqual(t);
    const manual = history.filter((v) => v.publishedMs + 7 * DAY <= t).map((v) => v.views7d as number);
    expect(manual).not.toContain(1080);
    // 8 measured videos (v0..v7): median of 1030 and 1040.
    expect(manual).toHaveLength(8);
    expect(baselineBefore(history, t)).toBe(1035);
  });

  it('later videos never change the context of an earlier one', () => {
    const t = history[10].publishedMs;
    const a = channelContextAt(history.slice(0, 11), t);
    const b = channelContextAt(history.map((v, i) => (i > 10 ? { ...v, views7d: 1e9 } : v)), t);
    expect(b).toEqual(a);
  });

  it('training vector == prediction vector for the same publication time', () => {
    const t = history[15].publishedMs;
    const ch = channelContextAt(history, t);
    const base = { durationS: 600, publishedAt: new Date(t), title: 'Why ETFs Beat Stocks', topicPhase: 2, topicMgi: 70, topicRecent7d: 3 };
    const x1 = vectorize({ ...base, ...ch });
    const x2 = vectorize({ ...base, ...channelContextAt([...history].reverse(), t) });
    expect(x1).toHaveLength(FEATURES.length);
    x1.forEach((v, i) => expect(Math.abs(v - x2[i])).toBeLessThan(1e-6));
    expect(FEATURES).not.toContain('subs_log');
  });

  it('topic score is taken before the publication day', () => {
    const scores = [
      { scored_at: '2026-01-09', mgi: 40, phase: 1 },
      { scored_at: '2026-01-10', mgi: 90, phase: 3 },
    ];
    expect(topicScoreBefore(scores, Date.UTC(2026, 0, 10, 15))).toEqual({ mgi: 40, phase: 1 });
  });

  it('viewsAt picks the closest snapshot within tolerance', () => {
    const snaps = [
      { at: T0 + 6 * DAY, views: 600 },
      { at: T0 + 7.2 * DAY, views: 720 },
      { at: T0 + 20 * DAY, views: 2000 },
    ];
    expect(viewsAt(snaps, T0, 7)).toBe(720);
    expect(viewsAt([{ at: T0 + 20 * DAY, views: 1 }], T0, 7)).toBeNull();
  });
});
