import { afterEach, describe, expect, it } from 'vitest';
import { isCronAuthorized } from '@/lib/auth/cron';

const ORIGINAL = process.env.CRON_SECRET;

describe('isCronAuthorized', () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL;
  });

  it('refuses "Bearer undefined" when the secret is unset', () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized('Bearer undefined')).toBe(false);
    expect(isCronAuthorized('Bearer ')).toBe(false);
  });

  it('refuses a too short secret', () => {
    process.env.CRON_SECRET = 'short';
    expect(isCronAuthorized('Bearer short')).toBe(false);
  });

  it('accepts only the exact bearer secret', () => {
    process.env.CRON_SECRET = 'a-long-enough-test-secret-value';
    expect(isCronAuthorized('Bearer a-long-enough-test-secret-value')).toBe(true);
    expect(isCronAuthorized('Bearer a-long-enough-test-secret-valuX')).toBe(false);
    expect(isCronAuthorized(null)).toBe(false);
  });
});
