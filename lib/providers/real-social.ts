import type { SocialMention, SocialProvider } from './social';

const TIMEOUT_MS = 10_000;

// Default subreddits per niche category
const DEFAULT_SUBREDDITS: Record<string, string[]> = {
  finance: ['investing', 'dividends', 'financialindependence'],
  psychology: ['psychology', 'selfimprovement', 'productivity'],
  ai_tools: ['artificial', 'LocalLLaMA', 'ChatGPT'],
};

export class RealSocialProvider implements SocialProvider {
  private redditToken: string | null = null;
  private redditTokenExpiry = 0;

  // ── Reddit OAuth ─────────────────────────────────────────────────
  private async getRedditToken(): Promise<string> {
    if (this.redditToken && Date.now() < this.redditTokenExpiry) {
      return this.redditToken;
    }

    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Missing REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET');
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': process.env.REDDIT_USER_AGENT ?? 'TubLyTI/1.0',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Reddit auth error ${res.status}`);
    }

    const data = await res.json();
    this.redditToken = data.access_token;
    // Expire 5 min before actual expiry
    this.redditTokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
    return this.redditToken!;
  }

  private async countReddit(
    query: string,
    subreddits: string[],
  ): Promise<number> {
    const token = await this.getRedditToken();
    const subs = subreddits.join('+');
    const url = new URL(`https://oauth.reddit.com/r/${subs}/search.json`);
    url.searchParams.set('q', query);
    url.searchParams.set('restrict_sr', 'true');
    url.searchParams.set('sort', 'new');
    url.searchParams.set('t', 'month');
    url.searchParams.set('limit', '100');

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': process.env.REDDIT_USER_AGENT ?? 'TubLyTI/1.0',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Reddit search error ${res.status}`);
    }

    const data = await res.json();
    // Filter to last 30 days
    const thirtyDaysAgo = Date.now() / 1000 - 30 * 86400;
    const posts = data?.data?.children ?? [];
    return posts.filter(
      (p: { data: { created_utc: number } }) =>
        p.data.created_utc >= thirtyDaysAgo,
    ).length;
  }

  // ── Hacker News (Algolia) ────────────────────────────────────────
  private async countHN(query: string): Promise<number> {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000 - 30 * 86400);
    const url = new URL('https://hn.algolia.com/api/v1/search_by_date');
    url.searchParams.set('query', query);
    url.searchParams.set('tags', 'story');
    url.searchParams.set('numericFilters', `created_at_i>${thirtyDaysAgo}`);
    url.searchParams.set('hitsPerPage', '0'); // only need count

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`HN Algolia error ${res.status}`);
    }

    const data = await res.json();
    return data.nbHits ?? 0;
  }

  // ── Interface ────────────────────────────────────────────────────
  async countMentions(
    query: string,
    source: 'reddit' | 'hn',
    nicheCategory?: string,
  ): Promise<SocialMention> {
    const today = new Date().toISOString().slice(0, 10);

    if (source === 'reddit') {
      const subreddits =
        DEFAULT_SUBREDDITS[nicheCategory ?? ''] ??
        DEFAULT_SUBREDDITS['ai_tools']!;
      const count = await this.countReddit(query, subreddits);
      return { source: 'reddit', count, date: today };
    }

    const count = await this.countHN(query);
    return { source: 'hn', count, date: today };
  }
}
