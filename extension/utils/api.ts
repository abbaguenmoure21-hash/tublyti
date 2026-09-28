import { getSettings } from './storage';

// ── Shared sub-types ──────────────────────────────────────────────────

export interface MgiScoreData {
  value: number;
  band: 'low' | 'medium' | 'high' | 'very_high';
  confidence: 'low' | 'medium' | 'high';
  freshness: string;
}

export interface FrustrationItem {
  text: string;
  label: string;
  likeCount: number;
}

export interface CompetitorItem {
  title: string;
  channelTitle: string;
  views: number | null;
  publishedAt: string;
}

export interface OutlierData {
  ratio: number;
  median: number;
  views: number;
  snapshotDate: string;
  explanation: string;
}

export interface SimilarChannel {
  id: string;
  title: string;
  subscriberCount: number;
}

export interface ChannelVideoItem {
  id: string;
  title: string;
  views: number | null;
  outlierRatio: number | null;
  publishedAt: string;
}

// ── Lookup result (flexible shape per page type) ──────────────────────

export interface LookupResult {
  type: 'video' | 'channel' | 'search';
  found: boolean;

  // Video fields
  topicId?: string;
  topicLabel?: string;
  similarity?: number;
  nicheName?: string;
  phase?: number | null;
  mgi?: MgiScoreData | null;
  outlier?: OutlierData | null;
  feasibilityGrade?: string;
  feasibilityNote?: string;
  frustrations?: FrustrationItem[];
  competitors?: CompetitorItem[];

  // Channel fields
  channelTitle?: string | null;
  subscriberCount?: number | null;
  medianViews?: number | null;
  publishingPace?: string | null;
  recentVideos?: ChannelVideoItem[];
  similarChannels?: SimilarChannel[];
  niches?: { id: string; name: string }[];
  estimatedMedian?: number | null;

  // Search fields
  topics?: {
    id: string;
    label: string;
    mgi: number;
    phase: number;
    nicheName?: string;
  }[];
}

// ── API calls ─────────────────────────────────────────────────────────

async function apiCall<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { apiUrl, token } = await getSettings();

  if (!token) {
    throw new Error('Jeton non configure. Ouvre les options de l\'extension.');
  }

  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    throw new Error('Jeton invalide ou revoque.');
  }

  if (res.status === 429) {
    throw new Error('Quota atteint. Reessaie plus tard.');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Erreur ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function lookupVideo(videoId: string): Promise<LookupResult> {
  return apiCall<LookupResult>('/api/ext/lookup', { type: 'video', id: videoId });
}

export async function lookupChannel(channelId: string): Promise<LookupResult> {
  return apiCall<LookupResult>('/api/ext/lookup', { type: 'channel', id: channelId });
}

export async function lookupSearch(query: string): Promise<LookupResult> {
  return apiCall<LookupResult>('/api/ext/lookup', { type: 'search', query });
}

export async function trackChannel(channelId: string, niche: string): Promise<{ ok: boolean }> {
  return apiCall<{ ok: boolean }>('/api/ext/track-channel', { channel_id: channelId, niche });
}

export async function addCandidate(channelId: string): Promise<{ ok: boolean }> {
  return apiCall<{ ok: boolean }>('/api/ext/track-channel', { channel_id: channelId, niche: '_candidates' });
}

export async function topicAction(
  action: 'mark_production' | 'generate_angles' | 'save_favorite',
  topicId: string,
): Promise<{ ok: boolean; message?: string }> {
  return apiCall<{ ok: boolean; message?: string }>('/api/ext/topic-action', { action, topic_id: topicId });
}

export async function testConnection(): Promise<{ ok: boolean; name?: string }> {
  const { apiUrl, token } = await getSettings();

  if (!token) throw new Error('Jeton non configure.');

  const res = await fetch(`${apiUrl}/api/ext/lookup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'ping' }),
  });

  if (res.status === 401) throw new Error('Jeton invalide ou revoque.');
  if (!res.ok) throw new Error(`Erreur serveur ${res.status}`);

  return { ok: true };
}
