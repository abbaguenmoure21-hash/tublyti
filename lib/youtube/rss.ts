/**
 * YouTube RSS feed parser — discovers new videos without using API quota.
 * Each channel has a public feed at:
 *   https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
 * Returns the last ~15 video IDs + publish dates.
 */

export interface RSSVideoEntry {
  videoId: string;
  title: string;
  channelId: string;
  publishedAt: string;
}

/**
 * Fetch recent video IDs from a channel's RSS feed (0 quota units).
 * Returns up to ~15 entries. Throws on network/parse errors.
 */
export async function fetchRSSVideos(channelId: string): Promise<RSSVideoEntry[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'TubLyTI/1.0 (+https://tublyti.com)' },
  });

  if (!res.ok) {
    throw new Error(`RSS feed ${res.status} for channel ${channelId}`);
  }

  const xml = await res.text();
  return parseRSSFeed(xml, channelId);
}

/**
 * Parse YouTube Atom XML feed into video entries.
 * YouTube feeds use Atom format with <entry> elements containing:
 *   <yt:videoId>, <title>, <published>
 */
export function parseRSSFeed(xml: string, channelId: string): RSSVideoEntry[] {
  const entries: RSSVideoEntry[] = [];

  // Match each <entry>...</entry> block
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryPattern.exec(xml)) !== null) {
    const block = match[1];

    const videoIdMatch = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const titleMatch = block.match(/<title>([^<]*)<\/title>/);
    const publishedMatch = block.match(/<published>([^<]+)<\/published>/);

    if (videoIdMatch) {
      entries.push({
        videoId: videoIdMatch[1].trim(),
        title: titleMatch ? decodeXMLEntities(titleMatch[1]) : '',
        channelId,
        publishedAt: publishedMatch?.[1]?.trim() ?? new Date().toISOString(),
      });
    }
  }

  return entries;
}

/** Decode basic XML entities (&amp; &lt; &gt; &quot; &apos;). */
function decodeXMLEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
