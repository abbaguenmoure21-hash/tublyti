/**
 * Verify the nightly pipeline step order guarantees:
 * each step must see data produced by previous steps.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Parse the nightly script to extract step order from runStep calls
function extractStepOrder(): string[] {
  const src = readFileSync(resolve(__dirname, '../scripts/nightly.ts'), 'utf-8');
  const steps: string[] = [];
  // Signature: runStep(runner, deadline, kind, fn) — the step name is the 3rd argument.
  const re = /runStep\(\s*runner\s*,\s*[^,]+,\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    steps.push(m[1]);
  }
  return steps;
}

describe('nightly pipeline order', () => {
  const steps = extractStepOrder();

  it('has at least 6 steps', () => {
    // Guard: a broken regex must fail loudly instead of yielding indexOf() === -1 everywhere.
    expect(steps).toContain('collect');
    expect(steps).toContain('score');
    expect(steps.length).toBeGreaterThanOrEqual(6);
  });

  it('runs collect before embed', () => {
    expect(steps.indexOf('collect')).toBeLessThan(steps.indexOf('embed'));
  });

  it('runs embed before attach', () => {
    expect(steps.indexOf('embed')).toBeLessThan(steps.indexOf('attach'));
  });

  it('runs attach before discover-topics', () => {
    expect(steps.indexOf('attach')).toBeLessThan(steps.indexOf('discover-topics'));
  });

  it('runs discover-topics before quality-gates', () => {
    expect(steps.indexOf('discover-topics')).toBeLessThan(steps.indexOf('quality-gates'));
  });

  it('runs quality-gates before search', () => {
    expect(steps.indexOf('quality-gates')).toBeLessThan(steps.indexOf('search'));
  });

  it('runs search before embed-pass2', () => {
    expect(steps.indexOf('search')).toBeLessThan(steps.indexOf('embed-pass2'));
  });

  it('runs classify before score', () => {
    expect(steps.indexOf('classify')).toBeLessThan(steps.indexOf('score'));
  });

  it('runs score after embed-pass2', () => {
    expect(steps.indexOf('embed-pass2')).toBeLessThan(steps.indexOf('score'));
  });

  it('only maintenance steps (reject-stale, aggregate) run after score', () => {
    const after = steps.slice(steps.indexOf('score') + 1);
    expect(after.every((s) => s === 'reject-stale' || s === 'aggregate')).toBe(true);
  });
});
