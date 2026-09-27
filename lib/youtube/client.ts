import { QuotaSoftLimitReached, getQuotaSoftLimit } from './quota';

// ── Types ───────────────────────────────────────────────────────────
export interface ChannelInfo {
  id: string;
  title: string;
  subscriberCount: number;
  uploadsPlaylistId: string;
}

export interface VideoInfo {
  id: string;
  channelId: string;
  title: string;
  publishedAt: string;
  durationSeconds: number;
}

export interface VideoSnapshot {
  videoId: string;
  views: number;
  likes: number;
  comments: number;
}

export interface CommentThread {
  id: string;
  videoId: string;
  text: string;
  likeCount: number;
  publishedAt: string;
}

// ── Interface ───────────────────────────────────────────────────────
export interface YouTubeClient {
  getChannels(ids: string[]): Promise<ChannelInfo[]>;
  resolveHandles(handles: string[]): Promise<ChannelInfo[]>;
  getPlaylistItems(playlistId: string, maxResults?: number): Promise<string[]>;
  getVideos(ids: string[]): Promise<VideoInfo[]>;
  getVideoSnapshots(ids: string[]): Promise<VideoSnapshot[]>;
  getCommentThreads(videoId: string, maxResults?: number): Promise<CommentThread[]>;
  getQuotaUsed(): number;
}

// ── ISO 8601 duration → seconds ─────────────────────────────────────
export function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] ?? '0', 10);
  const m = parseInt(match[2] ?? '0', 10);
  const s = parseInt(match[3] ?? '0', 10);
  return h * 3600 + m * 60 + s;
}

// ── Real implementation ─────────────────────────────────────────────
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

export class RealYouTubeClient implements YouTubeClient {
  private quotaUsed = 0;
  private readonly apiKey: string;
  private readonly softLimit: number;

  constructor(apiKey?: string, softLimit?: number) {
    this.apiKey = apiKey ?? process.env.YOUTUBE_API_KEY ?? '';
    this.softLimit = softLimit ?? getQuotaSoftLimit();
  }

  private checkQuota(cost: number) {
    this.quotaUsed += cost;
    if (this.quotaUsed >= this.softLimit) {
      throw new QuotaSoftLimitReached(this.quotaUsed, this.softLimit);
    }
  }

  private async fetch(endpoint: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${YT_BASE}/${endpoint}`);
    url.searchParams.set('key', this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API ${endpoint} ${res.status}: ${body}`);
    }
    return res.json();
  }

  async getChannels(ids: string[]): Promise<ChannelInfo[]> {
    const results: ChannelInfo[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      this.checkQuota(1);
      const data = (await this.fetch('channels', {
        part: 'snippet,contentDetails,statistics',
        id: batch.join(','),
        maxResults: '50',
      })) as { items?: Array<Record<string, unknown>> };

      for (const item of data.items ?? []) {
        const snippet = item.snippet as Record<string, string>;
        const stats = item.statistics as Record<string, string>;
        const cd = item.contentDetails as { relatedPlaylists?: { uploads?: string } };
        results.push({
          id: item.id as string,
          title: snippet.title,
          subscriberCount: parseInt(stats.subscriberCount ?? '0', 10),
          uploadsPlaylistId: cd.relatedPlaylists?.uploads ?? '',
        });
      }
    }
    return results;
  }

  async resolveHandles(handles: string[]): Promise<ChannelInfo[]> {
    const results: ChannelInfo[] = [];
    for (const handle of handles) {
      this.checkQuota(1);
      const data = (await this.fetch('channels', {
        part: 'snippet,contentDetails,statistics',
        forHandle: handle.replace('@', ''),
        maxResults: '1',
      })) as { items?: Array<Record<string, unknown>> };

      for (const item of data.items ?? []) {
        const snippet = item.snippet as Record<string, string>;
        const stats = item.statistics as Record<string, string>;
        const cd = item.contentDetails as { relatedPlaylists?: { uploads?: string } };
        results.push({
          id: item.id as string,
          title: snippet.title,
          subscriberCount: parseInt(stats.subscriberCount ?? '0', 10),
          uploadsPlaylistId: cd.relatedPlaylists?.uploads ?? '',
        });
      }
    }
    return results;
  }

  async getPlaylistItems(playlistId: string, maxResults = 50): Promise<string[]> {
    this.checkQuota(1);
    const data = (await this.fetch('playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults: String(Math.min(maxResults, 50)),
    })) as { items?: Array<{ contentDetails?: { videoId?: string } }> };

    return (data.items ?? [])
      .map((item) => item.contentDetails?.videoId)
      .filter((id): id is string => !!id);
  }

  async getVideos(ids: string[]): Promise<VideoInfo[]> {
    const results: VideoInfo[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      this.checkQuota(1);
      const data = (await this.fetch('videos', {
        part: 'snippet,contentDetails',
        id: batch.join(','),
        maxResults: '50',
      })) as { items?: Array<Record<string, unknown>> };

      for (const item of data.items ?? []) {
        const snippet = item.snippet as Record<string, string>;
        const cd = item.contentDetails as Record<string, string>;
        results.push({
          id: item.id as string,
          channelId: snippet.channelId,
          title: snippet.title,
          publishedAt: snippet.publishedAt,
          durationSeconds: parseDuration(cd.duration ?? ''),
        });
      }
    }
    return results;
  }

  async getVideoSnapshots(ids: string[]): Promise<VideoSnapshot[]> {
    const results: VideoSnapshot[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      this.checkQuota(1);
      const data = (await this.fetch('videos', {
        part: 'statistics',
        id: batch.join(','),
        maxResults: '50',
      })) as { items?: Array<Record<string, unknown>> };

      for (const item of data.items ?? []) {
        const stats = item.statistics as Record<string, string>;
        results.push({
          videoId: item.id as string,
          views: parseInt(stats.viewCount ?? '0', 10),
          likes: parseInt(stats.likeCount ?? '0', 10),
          comments: parseInt(stats.commentCount ?? '0', 10),
        });
      }
    }
    return results;
  }

  async getCommentThreads(videoId: string, maxResults = 100): Promise<CommentThread[]> {
    this.checkQuota(1);
    const data = (await this.fetch('commentThreads', {
      part: 'snippet',
      videoId,
      maxResults: String(Math.min(maxResults, 100)),
      order: 'relevance',
    })) as { items?: Array<Record<string, unknown>> };

    return (data.items ?? []).map((item) => {
      const top = (item.snippet as Record<string, unknown>)
        .topLevelComment as Record<string, unknown>;
      const snippet = top.snippet as Record<string, string>;
      return {
        id: top.id as string,
        videoId,
        text: snippet.textOriginal ?? snippet.textDisplay ?? '',
        likeCount: parseInt(snippet.likeCount ?? '0', 10),
        publishedAt: snippet.publishedAt,
      };
    });
  }

  getQuotaUsed(): number {
    return this.quotaUsed;
  }
}
