export const DEFAULT_NEXT = '/sujets';

/**
 * Validates a post-login destination so it can only point inside the app (no open redirect).
 * The URL is resolved the way the browser would (which strips tabs/newlines, turns "\" into "/",
 * decodes nothing more), then must keep the same origin and start with a single "/".
 */
export function safeNext(value: string | null | undefined, origin: string): string {
  if (!value || !value.startsWith('/')) return DEFAULT_NEXT;
  // Control characters and backslashes have no place in an internal path.
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return DEFAULT_NEXT;
  if (value.startsWith('//')) return DEFAULT_NEXT;
  let url: URL;
  let base: URL;
  try {
    base = new URL(origin);
    url = new URL(value, base);
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== base.origin) return DEFAULT_NEXT;
  const path = url.pathname + url.search + url.hash;
  if (!path.startsWith('/') || path.startsWith('//')) return DEFAULT_NEXT;
  return path;
}
