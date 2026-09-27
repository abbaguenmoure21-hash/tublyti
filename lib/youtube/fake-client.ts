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

  async getCommentThreads(videoId: string, maxResults = 100): Promise<CommentThread[]> {
    this.checkQuota(1);
    return Array.from({ length: Math.min(maxResults, 3) }, (_, i) => ({
      id: `fake-comment-${videoId}-${i}`,
      videoId,
      text: 'I wish someone would explain this better',
      likeCount: 10,
      publishedAt: new Date().toISOString(),
    }));
  }

  getQuotaUsed(): number {
    return this.quotaUsed;
  }
}
