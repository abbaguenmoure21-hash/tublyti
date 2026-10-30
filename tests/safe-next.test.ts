import { describe, expect, it } from 'vitest';
import { DEFAULT_NEXT, safeNext } from '@/lib/safe-next';

const ORIGIN = 'https://app.tublyti.test';

describe('safeNext', () => {
  it.each([
    ['//evil.com'],
    ['/\\evil.com'],
    ['\\\\evil.com'],
    ['/\t/evil.com'],
    ['/\n/evil.com'],
    ['/\r\n/evil.com'],
    ['%2F%09%2Fevil.com'],
    [decodeURIComponent('%2F%09%2Fevil.com')],
    ['https://evil.com'],
    ['https://evil'],
    ['javascript:alert(1)'],
    ['javascript:'],
    [' /sujets'],
    [''],
    [null],
    [undefined],
  ])('rejects %j', (value) => {
    expect(safeNext(value, ORIGIN)).toBe(DEFAULT_NEXT);
  });

  it('rejects the tab trick once read back from a query string', () => {
    const params = new URLSearchParams('next=%2F%09%2Fevil.com');
    expect(safeNext(params.get('next'), ORIGIN)).toBe(DEFAULT_NEXT);
  });

  it.each([
    ['/topics/abc?x=1', '/topics/abc?x=1'],
    ['/preflight', '/preflight'],
    ['/sujets#liste', '/sujets#liste'],
  ])('keeps internal path %j', (value, expected) => {
    expect(safeNext(value, ORIGIN)).toBe(expected);
  });
});
