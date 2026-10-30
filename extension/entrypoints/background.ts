import { parseYoutubeUrl, type YoutubePage } from '../utils/youtube-url';
import { getCache, setCache, getSettings } from '../utils/storage';
import type { LookupResult } from '../utils/api';

export default defineBackground(() => {
  const PHASE_COLORS: Record<number, string> = {
    0: '#8459c3',
    1: '#cf7c00',
    2: '#0e9254',
    3: '#d33949',
  };
  const UNKNOWN_COLOR = '#9ca3af';

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Open side panel on action click
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id) {
      chrome.sidePanel.open({ tabId: tab.id });
    }
  });

  // Listen for tab URL changes
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.id) {
      handleUrlChange(tab.id, changeInfo.url);
    }
  });

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      handleUrlChange(tab.id!, tab.url);
    }
  });

  function handleUrlChange(tabId: number, url: string) {
    // Debounce 500ms
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      processTab(tabId, url);
    }, 500);
  }

  async function processTab(tabId: number, url: string) {
    const page = parseYoutubeUrl(url);

    if (page.type === 'unknown') {
      // Clear badge on non-YouTube pages
      await chrome.action.setBadgeText({ text: '', tabId });
      return;
    }

    const cacheKey = getCacheKey(page);
    const cached = await getCache<LookupResult>(cacheKey);

    if (cached) {
      updateBadge(tabId, cached);
      return;
    }

    // Fetch from API
    try {
      const result = await fetchLookup(page);
      await setCache(cacheKey, result);
      updateBadge(tabId, result);

      // Store result for side panel to read
      await chrome.storage.session.set({ [`current_${tabId}`]: result });
    } catch {
      await chrome.action.setBadgeText({ text: '!', tabId });
      await chrome.action.setBadgeBackgroundColor({ color: '#d01c29', tabId });
    }
  }

  function getCacheKey(page: YoutubePage): string {
    switch (page.type) {
      case 'video': return `v:${page.id}`;
      case 'channel': return `c:${page.id}`;
      case 'search': return `s:${page.query}`;
      default: return 'unknown';
    }
  }

  async function fetchLookup(page: YoutubePage): Promise<LookupResult> {
    const { apiUrl, token } = await getSettings();
    if (!token) return { found: false, type: page.type === 'search' ? 'search' : page.type };

    const body: Record<string, unknown> = { type: page.type };
    if (page.type === 'video') body.id = page.id;
    else if (page.type === 'channel') body.id = page.id;
    else if (page.type === 'search') body.query = page.query;

    const res = await fetch(`${apiUrl}/api/ext/lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    // Server error / revoked token / rate limit: throw so the badge shows "!" and nothing is cached
    // (caching it as "not found" would hide the problem for 10 minutes).
    if (!res.ok) throw new Error(`lookup HTTP ${res.status}`);
    return res.json();
  }

  function updateBadge(tabId: number, result: LookupResult) {
    // Phase can be a number or {phase, label} object depending on page type
    let phaseNum: number | null = null;
    if (result.found && result.phase != null) {
      phaseNum = typeof result.phase === 'object' ? (result.phase as { phase: number }).phase : result.phase as number;
    }

    if (phaseNum != null) {
      const text = `P${phaseNum}`;
      const color = PHASE_COLORS[phaseNum] ?? UNKNOWN_COLOR;
      chrome.action.setBadgeText({ text, tabId });
      chrome.action.setBadgeBackgroundColor({ color, tabId });
    } else {
      chrome.action.setBadgeText({ text: '+', tabId });
      chrome.action.setBadgeBackgroundColor({ color: UNKNOWN_COLOR, tabId });
    }
  }
});
