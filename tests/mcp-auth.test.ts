import { describe, it, expect } from 'vitest';
import { timingSafeCompare } from '@/lib/auth/timing-safe';

describe('timingSafeCompare', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeCompare('my-secret-token', 'my-secret-token')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeCompare('my-secret-token', 'wrong-token')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeCompare('short', 'a-much-longer-string')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(timingSafeCompare('', 'something')).toBe(false);
  });

  it('returns true for both empty', () => {
    expect(timingSafeCompare('', '')).toBe(true);
  });

  it('returns false for unicode with different byte lengths', () => {
    expect(timingSafeCompare('café', 'cafe')).toBe(false);
  });
});
