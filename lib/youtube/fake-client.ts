import type {
  YouTubeClient,
  ChannelInfo,
  VideoInfo,
  VideoSnapshot,
  CommentThread,
} from './client';

export class FakeYouTubeClient implements YouTubeClient {
  private quotaUsed = 0;

  async getChannels(ids: string[]): Promise<ChannelInfo[]> {
    this.quotaUsed += 1;
    return ids.map((id) => ({
      id,
      title: `Fake Channel ${id}`,
      subscriberCount: 50000,
      uploadsPlaylistId: `UU${id.slice(2)}`,
    }));
  }

  async getPlaylistItems(_playlistId: string, maxResults = 50): Promise<string[]> {
    this.quotaUsed += 1;
    return Array.from({ length: Math.min(maxResults, 5) }, (_, i) => `fake-video-${i}`);
  }

  async getVideos(ids: string[]): Promise<VideoInfo[]> {
    this.quotaUsed += 1;
    return ids.map((id) => ({
      id,
      channelId: 'fake-channel',
      title: `Fake Video ${id}`,
      publishedAt: new Date().toISOString(),
      durationSeconds: 600,
    }));
  }

  async getVideoSnapshots(ids: string[]): Promise<VideoSnapshot[]> {
    this.quotaUsed += 1;
    return ids.map((id) => ({
      videoId: id,
      views: 10000,
      likes: 500,
      comments: 100,
    }));
  }

  async getCommentThreads(videoId: string, maxResults = 100): Promise<CommentThread[]> {
    this.quotaUsed += 1;
    return Array.from({ length: Math.min(maxResults, 3) }, (_, i) => ({
      id: `fake-comment-${videoId}-${i}`,
      videoId,
      text: 'I wish someone would explain this better',
      likeCount: 10,
      publishedAt: new Date().toISOString(),
    }));
  }

  async searchVideos(_query: string, maxResults = 10): Promise<string[]> {
    this.quotaUsed += 100;
    return Array.from({ length: Math.min(maxResults, 3) }, (_, i) => `fake-search-result-${i}`);
  }

  getQuotaUsed(): number {
    return this.quotaUsed;
  }
}
