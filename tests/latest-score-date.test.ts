import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock createServiceClient before importing the module
const mockSingle = vi.fn();
const mockLimit = vi.fn(() => ({ single: mockSingle }));
const mockOrder = vi.fn(() => ({ limit: mockLimit }));
const mockSelect = vi.fn(() => ({ order: mockOrder }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockDb = { from: mockFrom };

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => mockDb,
}));

import { getLatestScoreDate } from '@/lib/scoring/latest-score-date';

describe('getLatestScoreDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({ data: null, error: null });
  });

  it('returns scored_at from the latest row', async () => {
    mockSingle.mockResolvedValue({ data: { scored_at: '2026-09-25' }, error: null });

    const date = await getLatestScoreDate(mockDb as never);

    expect(date).toBe('2026-09-25');
    expect(mockFrom).toHaveBeenCalledWith('topic_scores');
    expect(mockSelect).toHaveBeenCalledWith('scored_at');
    expect(mockOrder).toHaveBeenCalledWith('scored_at', { ascending: false });
    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  it('falls back to today when no scores exist', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });

    const date = await getLatestScoreDate(mockDb as never);

    const today = new Date().toISOString().slice(0, 10);
    expect(date).toBe(today);
  });
});
