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

export interface YouTubeClient {
  getChannels(ids: string[]): Promise<ChannelInfo[]>;
  getPlaylistItems(playlistId: string, maxResults?: number): Promise<string[]>;
  getVideos(ids: string[]): Promise<VideoInfo[]>;
  getVideoSnapshots(ids: string[]): Promise<VideoSnapshot[]>;
  getCommentThreads(videoId: string, maxResults?: number): Promise<CommentThread[]>;
  searchVideos(query: string, maxResults?: number): Promise<string[]>;
  getQuotaUsed(): number;
}
