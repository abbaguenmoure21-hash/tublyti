import { describe, it, expect } from 'vitest';
import { parseRSSFeed } from '../lib/youtube/rss';

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns="http://www.w3.org/2005/Atom">
  <title>Graham Stephan</title>
  <entry>
    <yt:videoId>abc123</yt:videoId>
    <title>How To Invest $1000 In 2025</title>
    <published>2025-01-15T16:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>def456</yt:videoId>
    <title>Why I&apos;m Buying ETFs &amp; Not Individual Stocks</title>
    <published>2025-01-10T14:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>ghi789</yt:videoId>
    <title>The &#36;100k Mistake</title>
    <published>2025-01-05T12:00:00+00:00</published>
  </entry>
</feed>`;

describe('parseRSSFeed', () => {
  it('parses video entries from YouTube Atom feed', () => {
    const entries = parseRSSFeed(SAMPLE_FEED, 'UC_CHANNEL');

    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      videoId: 'abc123',
      title: 'How To Invest $1000 In 2025',
      channelId: 'UC_CHANNEL',
      publishedAt: '2025-01-15T16:00:00+00:00',
    });
  });

  it('decodes XML entities in titles', () => {
    const entries = parseRSSFeed(SAMPLE_FEED, 'UC_CHANNEL');

    expect(entries[1].title).toBe("Why I'm Buying ETFs & Not Individual Stocks");
  });

  it('decodes numeric character references', () => {
    const entries = parseRSSFeed(SAMPLE_FEED, 'UC_CHANNEL');

    expect(entries[2].title).toBe('The $100k Mistake');
  });

  it('returns empty array for empty feed', () => {
    const entries = parseRSSFeed('<feed></feed>', 'UC_CHANNEL');
    expect(entries).toHaveLength(0);
  });

  it('skips entries without videoId', () => {
    const xml = `<feed>
      <entry>
        <title>No video ID</title>
        <published>2025-01-01T00:00:00Z</published>
      </entry>
    </feed>`;
    const entries = parseRSSFeed(xml, 'UC_CHANNEL');
    expect(entries).toHaveLength(0);
  });
});
