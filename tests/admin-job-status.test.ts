import { describe, it, expect } from 'vitest';
import { groupRuns, jobState, lastNightlyRun, formatDuration, type JobRow } from '@/lib/admin/job-status';

function job(id: string, kind: string, start: string, durS: number, error: string | null = null, quota = 0): JobRow {
  const s = new Date(start).getTime();
  return { id, kind, started_at: start, finished_at: new Date(s + durS * 1000).toISOString(), error, quota_used: quota, items_processed: 1 };
}

describe('admin job status', () => {
  it('distinguishes skipped steps from errors', () => {
    expect(jobState(job('a', 'collect', '2026-10-27T02:00:00Z', 1, 'skipped: deadline reached'))).toBe('skipped');
    expect(jobState({ ...job('a', 'collect', '2026-10-27T02:00:00Z', 1), status: 'skipped' })).toBe('skipped');
    expect(jobState(job('b', 'collect', '2026-10-27T02:00:00Z', 1, 'boom'))).toBe('error');
    expect(jobState(job('c', 'collect', '2026-10-27T02:00:00Z', 1))).toBe('ok');
  });

  it('groups jobs into nightly runs and sums them', () => {
    const rows = [
      job('1', 'user-channels', '2026-10-26T02:00:00Z', 30, null, 10),
      job('2', 'collect', '2026-10-26T02:01:00Z', 300, null, 5000),
      job('3', 'score', '2026-10-26T02:10:00Z', 60, 'skipped: deadline reached'),
      job('4', 'user-channels', '2026-10-27T02:00:00Z', 30, null, 20),
      job('5', 'collect', '2026-10-27T02:01:00Z', 120, 'boom', 100),
      job('6', 'collect', '2026-10-27T14:00:00Z', 60, null, 300), // manual relaunch
    ];
    const runs = groupRuns(rows);
    expect(runs).toHaveLength(3);
    expect(runs[0].jobs.map((j) => j.id)).toEqual(['6']);
    const night = lastNightlyRun(runs)!;
    expect(night.jobs.map((j) => j.id)).toEqual(['4', '5']);
    expect(night.quota).toBe(120);
    expect(night.errors).toBe(1);
    expect(runs[2].skipped).toBe(1);
    expect(runs[2].totalMs).toBe(11 * 60_000);
  });

  it('marks a step that never finished as interrupted and counts it as a failure', () => {
    const now = new Date('2026-10-27T05:00:00Z').getTime();
    const started = { id: 'x', kind: 'collect', started_at: '2026-10-27T02:00:00Z', finished_at: null, error: null, quota_used: 0 };
    expect(jobState(started, now)).toBe('interrupted');
    // Still within the nightly budget: genuinely running.
    expect(jobState(started, new Date('2026-10-27T02:05:00Z').getTime())).toBe('running');
    const runs = groupRuns([job('1', 'user-channels', '2026-10-27T01:59:00Z', 30), started], now);
    expect(runs[0].errors).toBe(1);
    expect(runs[0].interrupted).toBe(1);
    expect(runs[0].running).toBe(0);
  });

  it('ignores manual relaunches when looking for the last night', () => {
    const runs = groupRuns([job('m', 'collect', '2026-10-27T14:00:00Z', 60)]);
    expect(lastNightlyRun(runs)).toBeNull();
  });

  it('formats durations in French', () => {
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(252_000)).toBe('4 min 12 s');
  });
});
