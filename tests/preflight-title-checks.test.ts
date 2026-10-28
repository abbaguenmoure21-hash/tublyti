import { describe, expect, it } from 'vitest';
import { titleChecks } from '@/lib/preflight/titles';

describe('titleChecks (accented words)', () => {
  it('detects French curiosity words with accents', () => {
    const { checks } = titleChecks('La vérité cachée sur les pyramides');
    expect(checks[1].ok).toBe(true);
  });

  it('does not match a word inside another word', () => {
    const { checks } = titleChecks('Showhow somewhat plain title here');
    expect(checks[1].ok).toBe(false);
  });
});
