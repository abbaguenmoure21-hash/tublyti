import { QuotaSoftLimitReached } from './quota';
import type {
  YouTubeClient,
  ChannelInfo,
  VideoInfo,
  VideoSnapshot,
  CommentThread,
} from './client';

export class FakeYouTubeClient implements YouTubeClient {
  private quotaUsed = 0;
  private readonly softLimit: number;

  constructor(softLimit = 8000) {
    this.softLimit = softLimit;
  }

  private checkQuota(cost: number) {
    this.quotaUsed += cost;
    if (this.quotaUsed >= this.softLimit) {
      throw new QuotaSoftLimitReached(this.quotaUsed, this.softLimit);
    }
  }

  async getChannels(ids: string[]): Promise<ChannelInfo[]> {
    this.checkQuota(1);
    return ids.map((id) => ({
      id,
      title: `Fake Channel ${id}`,
      subscriberCount: 50000,
      uploadsPlaylistId: `UU${id.slice(2)}`,
    }));
  }

  async resolveHandles(handles: string[]): Promise<ChannelInfo[]> {
    return handles.map((h, i) => {
      this.checkQuota(1);
      return {
        id: `UCfake${i}`,
        title: `Fake ${h}`,
        subscriberCount: 50000,
        uploadsPlaylistId: `UUfake${i}`,
      };
    });
  }

  async getPlaylistItems(_playlistId: string, maxResults = 50): Promise<string[]> {
    this.checkQuota(1);
    return Array.from({ length: Math.min(maxResults, 5) }, (_, i) => `fake-video-${i}`);
  }

  async getVideos(ids: string[]): Promise<VideoInfo[]> {
    this.checkQuota(1);
    return ids.map((id) => ({
      id,
      channelId: 'fake-channel',
      title: `Fake Video ${id}`,
      publishedAt: new Date().toISOString(),
      durationSeconds: 600,
      thumbnailUrl: null,
    }));
  }

  async getVideoSnapshots(ids: string[]): Promise<VideoSnapshot[]> {
    this.checkQuota(1);
    return ids.map((id) => ({
      videoId: id,
      views: 10000,
      likes: 500,
      comments: 100,
    }));
  }

  async getCommentThreads(videoId: string, maxResults = 100, maxPages = 1): Promise<CommentThread[]> {
    const allComments: CommentThread[] = [];
    const perPage = Math.min(maxResults, 100);
    for (let page = 0; page < maxPages; page++) {
      this.checkQuota(1);
      const count = Math.min(perPage, 3);
      for (let i = 0; i < count; i++) {
        allComments.push({
          id: `fake-comment-${videoId}-p${page}-${i}`,
          videoId,
          text: 'I wish someone would explain this better and in more detail',
          likeCount: 10,
          publishedAt: new Date().toISOString(),
        });
      }
    }
    return allComments;
  }

  getQuotaUsed(): number {
    return this.quotaUsed;
  }
}
