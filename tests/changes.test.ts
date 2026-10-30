import { describe, it, expect } from 'vitest';
import { pace, changeVerdict, byBestEffect, type Snap, type ChangeRow } from '@/lib/changes';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 28, 12);
/** Daily snapshots from `fromDay` to `toDay` (days relative to NOW, negative = past), `perDay` views/day. */
function series(fromDay: number, toDay: number, perDay: (d: number) => number, start = 10_000): Snap[] {
  const out: Snap[] = [];
  let views = start;
  for (let d = fromDay; d <= toDay; d++) {
    out.push({ t: NOW + d * DAY, views });
    views += perDay(d);
  }
  return out;
}

describe('pace', () => {
  it('flags a 45-day-old change without snapshots before it as no_before (not too_recent)', () => {
    const at = NOW - 45 * DAY;
    const snaps = series(-30, 0, () => 500); // purge kept only 30 days
    const p = pace(snaps, at, { now: NOW });
    expect(p.effect).toBeNull();
    expect(p.reason).toBe('no_before');
    expect(changeVerdict(p).label).toBe('Pas mesurable');
  });

  it('flags a change from yesterday as too_recent', () => {
    const at = NOW - 0.5 * DAY;
    const snaps = series(-10, 0, () => 500);
    const p = pace(snaps, at, { now: NOW });
    expect(p.effect).toBeNull();
    expect(p.reason).toBe('too_recent');
    expect(changeVerdict(p).label).toBe('Trop récent');
  });

  it('measures the effect when data exists on both sides', () => {
    const at = NOW - 10 * DAY + 1000;
    const snaps = series(-20, 0, (d) => (d < -10 ? 1000 : 3000));
    const p = pace(snaps, at, { now: NOW });
    expect(p.reason).toBeNull();
    expect(p.effect).toBeCloseTo(3, 1);
    expect(changeVerdict(p).tone).toBe('up');
  });

  it('refuses to measure low-volume videos (4 -> 20 views/day)', () => {
    const at = NOW - 10 * DAY + 1000;
    const snaps = series(-20, 0, (d) => (d < -10 ? 4 : 20));
    const p = pace(snaps, at, { now: NOW });
    expect(p.effect).toBeNull();
    expect(p.reason).toBe('low_volume');
  });

  it('refuses to measure a change made on a video too young', () => {
    const at = NOW - 10 * DAY + 1000;
    const snaps = series(-20, 0, () => 1000);
    const p = pace(snaps, at, { now: NOW, publishedAt: at - 1 * DAY });
    expect(p.reason).toBe('too_young');
  });
});

describe('changeVerdict', () => {
  it('distinguishes a drop from no effect', () => {
    expect(changeVerdict({ effect: 0.5, reason: null }).label).toBe('Rythme en baisse ×0,5');
    expect(changeVerdict({ effect: 1, reason: null }).label).toBe('Sans effet net');
  });
});

describe('byBestEffect', () => {
  it('puts measured changes first', () => {
    const row = (effect: number | null, pb: number | null, pa: number | null) => ({ effect, paceBefore: pb, paceAfter: pa }) as ChangeRow;
    const sorted = [row(null, 4, 20), row(2.5, 20_000, 50_000), row(1.1, 100, 110)].sort(byBestEffect);
    expect(sorted.map((r) => r.effect)).toEqual([2.5, 1.1, null]);
  });
});
