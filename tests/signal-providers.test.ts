import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTrendProvider } from '@/lib/signals/collect-signals';
import { FakeTrendProvider } from '@/lib/providers/trends';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('trend provider in production', () => {
  it('no SERPAPI_KEY → no provider (step skipped), never the random fake', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SERPAPI_KEY', '');
    vi.stubEnv('TREND_PROVIDER', '');
    expect(createTrendProvider()).toBeNull();
  });

  it('TREND_PROVIDER=fake is refused outside tests / demo', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO', '');
    vi.stubEnv('TREND_PROVIDER', 'fake');
    expect(createTrendProvider()).toBeNull();
  });

  it('fake allowed in demo mode only', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEMO', 'true');
    vi.stubEnv('TREND_PROVIDER', 'fake');
    expect(createTrendProvider()).toBeInstanceOf(FakeTrendProvider);
  });
});
