const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Get a cached value from chrome.storage.session.
 * Returns null if expired or missing.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const result = await chrome.storage.session.get(key);
    const entry = result[key] as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      await chrome.storage.session.remove(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Set a cached value in chrome.storage.session.
 */
export async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    await chrome.storage.session.set({ [key]: entry });
  } catch {
    // Session storage may not be available in all contexts
  }
}

/**
 * Get stored settings (URL + token) from chrome.storage.local.
 */
export async function getSettings(): Promise<{ apiUrl: string; token: string }> {
  const result = await chrome.storage.local.get(['tublyti_url', 'tublyti_token']);
  return {
    apiUrl: (result.tublyti_url as string) || 'https://tublyti.vercel.app',
    token: (result.tublyti_token as string) || '',
  };
}

/**
 * Save settings to chrome.storage.local.
 */
export async function saveSettings(apiUrl: string, token: string): Promise<void> {
  await chrome.storage.local.set({
    tublyti_url: apiUrl.replace(/\/$/, ''),
    tublyti_token: token,
  });
  // Lookup results depend on the token's account: drop them when the settings change.
  try {
    await chrome.storage.session.clear();
  } catch {
    // Session storage may not be available in all contexts
  }
}
