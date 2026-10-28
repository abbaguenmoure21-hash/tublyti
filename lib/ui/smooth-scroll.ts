/**
 * scrollIntoView that honours the OS "reduce motion" setting
 * (the CSS prefers-reduced-motion rule does not cover JS-driven scrolling).
 */
export function smoothScrollIntoView(
  el: Element | null | undefined,
  options: Omit<ScrollIntoViewOptions, 'behavior'> = { block: 'start' },
): void {
  if (!el) return;
  const reduce =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ ...options, behavior: reduce ? 'auto' : 'smooth' });
}
