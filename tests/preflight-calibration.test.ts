import { describe, expect, it } from 'vitest';
import { calibrationFrom } from '@/lib/preflight/engine';

describe('preflight calibration', () => {
  it('converges to a constant ×2 bias without oscillating', () => {
    const rows: { predicted_multiple: number; actual_multiple: number; predicted_p2x: number | null; raw: number | null }[] = [];
    const factors: number[] = [];
    for (let i = 0; i < 40; i++) {
      // Newest first, 30 rows max (like the query).
      const { factor } = calibrationFrom(rows.slice(0, 30));
      factors.push(factor);
      const raw = 0.5 + (i % 7) * 0.3;
      rows.unshift({ predicted_multiple: raw * factor, actual_multiple: raw * 2, predicted_p2x: null, raw });
    }
    const last = factors.slice(-20);
    for (const f of last) expect(Math.abs(f - 2)).toBeLessThanOrEqual(0.1);
  });

  it('old rows without raw are de-calibrated by the caller (raw = predicted / stored factor)', () => {
    const rows = Array.from({ length: 12 }, () => ({ predicted_multiple: 2, actual_multiple: 2, predicted_p2x: null, raw: 1 }));
    expect(calibrationFrom(rows).factor).toBe(2);
  });
});
