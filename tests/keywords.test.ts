import { describe, expect, it } from 'vitest';
import { containsWord } from '@/lib/keywords';

describe('containsWord', () => {
  it('matches short terms as whole words only', () => {
    expect(containsWord('Rain again, she said', 'AI')).toBe(false);
    expect(containsWord('Best AI tools in 2026', 'AI')).toBe(true);
    expect(containsWord("Pourquoi l'IA change tout", 'IA')).toBe(true);
    expect(containsWord('Why ETFs win', 'ETF')).toBe(false);
    expect(containsWord('ETF vs stocks', 'etf')).toBe(true);
  });

  it('handles accents and multi-word terms', () => {
    expect(containsWord('La vérité cachée sur X', 'vérité')).toBe(true);
    expect(containsWord('Invérités', 'vérité')).toBe(false);
    expect(containsWord('Passive   income ideas', 'passive income')).toBe(true);
  });

  it('escapes regex characters', () => {
    expect(containsWord('Learn C++ fast', 'C++')).toBe(true);
  });
});
