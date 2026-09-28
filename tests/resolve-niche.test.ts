import { describe, it, expect } from 'vitest';
import { resolveNiche, stripAccents } from '@/lib/niches/resolve';

const NICHES = [
  { id: '1', name: 'Personal Finance', category: 'finance', owner_channel: 'Wealth Decoded' },
  { id: '2', name: 'Psychologie pratique', category: 'psychology', owner_channel: 'Mind Unlocked' },
  { id: '3', name: 'AI Tools & Automation', category: 'ai_tools', owner_channel: 'AI Unchained' },
];

describe('stripAccents', () => {
  it('removes diacritics', () => {
    expect(stripAccents('Émergence')).toBe('Emergence');
    expect(stripAccents('Fenêtre idéale')).toBe('Fenetre ideale');
    expect(stripAccents('naïve café résumé')).toBe('naive cafe resume');
  });

  it('leaves ASCII untouched', () => {
    expect(stripAccents('hello world')).toBe('hello world');
  });
});

describe('resolveNiche', () => {
  it('resolves by exact name (case-insensitive)', () => {
    const result = resolveNiche('personal finance', NICHES);
    expect(result.niche?.id).toBe('1');
  });

  it('resolves by category', () => {
    const result = resolveNiche('finance', NICHES);
    expect(result.niche?.id).toBe('1');
  });

  it('resolves by category with different casing', () => {
    const result = resolveNiche('PSYCHOLOGY', NICHES);
    expect(result.niche?.id).toBe('2');
  });

  it('resolves by owner_channel', () => {
    const result = resolveNiche('Wealth Decoded', NICHES);
    expect(result.niche?.id).toBe('1');
  });

  it('resolves by owner_channel (case-insensitive)', () => {
    const result = resolveNiche('ai unchained', NICHES);
    expect(result.niche?.id).toBe('3');
  });

  it('resolves by partial name match', () => {
    const result = resolveNiche('psycho', NICHES);
    expect(result.niche?.id).toBe('2');
  });

  it('resolves accent-insensitively', () => {
    const niches = [
      { id: '4', name: 'Économie', category: 'economie', owner_channel: null },
    ];
    const result = resolveNiche('economie', niches);
    expect(result.niche?.id).toBe('4');
  });

  it('returns null + available list when no match', () => {
    const result = resolveNiche('cooking', NICHES);
    expect(result.niche).toBeNull();
    expect(result.available).toEqual([
      'Personal Finance',
      'Psychologie pratique',
      'AI Tools & Automation',
    ]);
  });

  it('returns null for empty query', () => {
    const result = resolveNiche('', NICHES);
    expect(result.niche).toBeNull();
  });

  it('handles ai_tools category', () => {
    const result = resolveNiche('ai_tools', NICHES);
    expect(result.niche?.id).toBe('3');
  });
});
