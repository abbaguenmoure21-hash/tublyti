export type YoutubePage =
  | { type: 'video'; id: string }
  | { type: 'channel'; id: string }
  | { type: 'search'; query: string }
  | { type: 'unknown' };

/**
 * Parse a YouTube URL to extract page type and identifier.
 * Never reads DOM — only the URL.
 */
export function parseYoutubeUrl(url: string): YoutubePage {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('youtube.com')) return { type: 'unknown' };

    // /watch?v=xxx or /shorts/xxx
    const videoId = u.searchParams.get('v');
    if (videoId) return { type: 'video', id: videoId };

    const shortsMatch = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return { type: 'video', id: shortsMatch[1] };

    // /@handle or /channel/UCxxx or /c/xxx
    const channelMatch = u.pathname.match(/^\/@([^/]+)/);
    if (channelMatch) return { type: 'channel', id: `@${channelMatch[1]}` };

    const channelIdMatch = u.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (channelIdMatch) return { type: 'channel', id: channelIdMatch[1] };

    const customMatch = u.pathname.match(/^\/c\/([^/]+)/);
    if (customMatch) return { type: 'channel', id: customMatch[1] };

    // /results?search_query=xxx
    const searchQuery = u.searchParams.get('search_query');
    if (u.pathname === '/results' && searchQuery) {
      return { type: 'search', query: searchQuery };
    }

    return { type: 'unknown' };
  } catch {
    return { type: 'unknown' };
  }
}
