/**
 * Enrich insufficient topics:
 * 1. Targeted attachment: match topic centroids against unattached same-niche videos (0 quota)
 * 2. YouTube search fallback: search for starved topics still under 5 videos (100 units/search)
 *
 * Threshold: 0.72 (audit recommendation — higher than general 0.66 to ensure quality)
 * Cap: 40 videos per topic per night (targeted), EMERGING_SEARCHES_PER_NIGHT searches (default 15)
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { EmbeddingProvider } from '../providers/embeddings';
import { searchSingle } from '../youtube/search';
import { getQuotaSoftLimit } from '../youtube/quota';

const ATTACH_THRESHOLD = 0.72;
const MAX_ATTACH_PER_TOPIC = 40;

// ── Utilities ─────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function parseEmbedding(raw: unknown): number[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch {
      return raw.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
  }
  return [];
}

function formatVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

function averageEmbedding(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dims = embeddings[0].length;
  const avg = new Array(dims).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dims; i++) avg[i] += emb[i];
  }
  const norm = Math.sqrt(avg.reduce((s, v) => s + v * v, 0)) || 1;
  return avg.map((v) => v / norm);
}

// ── Types ─────────────────────────────────────────────────────────────

export interface AttachInsufficientResult {
  topicsProcessed: number;
  videosAttached: number;
  details: Record<string, number>;
}

export interface EmergingSearchResult {
  searchesPerformed: number;
  videosFound: number;
  videosAttached: number;
  quotaUsed: number;
  /** Chaînes pas encore suivies proposées comme candidates (vidéos proches du sujet). */
  channelsProposed?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

interface InsufficientTopic {
  id: string;
  label: string;
  niche_id: string;
  embedding: number[];
  created_at: string;
}

/**
 * Load active topics whose latest score has confidence='insufficient'.
 */
async function loadInsufficientTopics(db: SupabaseClient): Promise<InsufficientTopic[]> {
  // Get latest score per topic, find insufficient ones
  const { data: scores } = await db
    .from('topic_scores')
    .select('topic_id, confidence, scored_at')
    .order('scored_at', { ascending: false });

  const seen = new Set<string>();
  const insufficientIds: string[] = [];
  for (const s of scores ?? []) {
    if (seen.has(s.topic_id)) continue;
    seen.add(s.topic_id);
    if (s.confidence === 'insufficient') insufficientIds.push(s.topic_id);
  }

  if (insufficientIds.length === 0) return [];

  // Batch load in groups of 200 (Supabase .in() limit)
  const allTopics: InsufficientTopic[] = [];
  for (let i = 0; i < insufficientIds.length; i += 200) {
    const batch = insufficientIds.slice(i, i + 200);
    const { data: topics } = await db
      .from('topics')
      .select('id, label, niche_id, embedding, created_at')
      .in('id', batch)
      .eq('status', 'active')
      .not('embedding', 'is', null);

    for (const t of topics ?? []) {
      const emb = parseEmbedding(t.embedding);
      if (emb.length > 0) {
        allTopics.push({
          id: t.id, label: t.label, niche_id: t.niche_id,
          embedding: emb, created_at: t.created_at,
        });
      }
    }
  }

  return allTopics;
}

// ── Step 1: Targeted attachment ───────────────────────────────────────

/**
 * For each active topic with confidence='insufficient', find same-niche
 * unattached videos from the last 30 days and attach if similarity >= 0.72.
 * Zero YouTube quota — operates entirely on existing embeddings.
 */
export async function runAttachInsufficient(
  db: SupabaseClient,
  deadlineMs: number,
): Promise<AttachInsufficientResult> {
  const result: AttachInsufficientResult = {
    topicsProcessed: 0, videosAttached: 0, details: {},
  };

  const insufficientTopics = await loadInsufficientTopics(db);
  if (insufficientTopics.length === 0) return result;

  // Group topics by niche for efficient video scanning
  const topicsByNiche = new Map<string, InsufficientTopic[]>();
  for (const t of insufficientTopics) {
    if (!topicsByNiche.has(t.niche_id)) topicsByNiche.set(t.niche_id, []);
    topicsByNiche.get(t.niche_id)!.push(t);
  }

  // Channel → niche mapping
  const { data: channels } = await db.from('channels').select('id, niche_id');
  const channelNiche = new Map((channels ?? []).map((c) => [c.id, c.niche_id]));

  // Track how many attached per topic
  const attachCount = new Map<string, number>();

  const cutoff30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const PAGE = 500;
  let offset = 0;

  while (Date.now() < deadlineMs) {
    const { data: videos } = await db
      .from('videos')
      .select('id, channel_id, title_embedding')
      .is('topic_id', null)
      .not('title_embedding', 'is', null)
      .gte('published_at', cutoff30d)
      .range(offset, offset + PAGE - 1);

    if (!videos?.length) break;

    for (const video of videos) {
      const nicheId = channelNiche.get(video.channel_id);
      if (!nicheId) continue;

      const nicheTopics = topicsByNiche.get(nicheId);
      if (!nicheTopics?.length) continue;

      const videoEmb = parseEmbedding(video.title_embedding);
      if (videoEmb.length === 0) continue;

      // Find best matching insufficient topic in this niche
      let bestSim = 0;
      let bestTopic: InsufficientTopic | null = null;

      for (const topic of nicheTopics) {
        if ((attachCount.get(topic.id) ?? 0) >= MAX_ATTACH_PER_TOPIC) continue;
        const sim = cosineSimilarity(videoEmb, topic.embedding);
        if (sim >= ATTACH_THRESHOLD && sim > bestSim) {
          bestSim = sim;
          bestTopic = topic;
        }
      }

      if (bestTopic) {
        await db.from('videos').update({ topic_id: bestTopic.id }).eq('id', video.id);
        const count = (attachCount.get(bestTopic.id) ?? 0) + 1;
        attachCount.set(bestTopic.id, count);
        result.videosAttached++;
      }
    }

    offset += videos.length;
    if (videos.length < PAGE) break;
  }

  // Recalculate embeddings for topics that got new videos
  const touchedTopicIds = [...attachCount.keys()].filter((id) => (attachCount.get(id) ?? 0) > 0);
  for (const topicId of touchedTopicIds) {
    const topic = insufficientTopics.find((t) => t.id === topicId);
    if (!topic) continue;

    result.topicsProcessed++;
    result.details[topic.label] = attachCount.get(topicId) ?? 0;

    const { data: members } = await db
      .from('videos')
      .select('title_embedding')
      .eq('topic_id', topicId)
      .not('title_embedding', 'is', null)
      .limit(200);

    if (members?.length) {
      const embeddings = members
        .map((m) => parseEmbedding(m.title_embedding))
        .filter((e) => e.length > 0);
      if (embeddings.length > 0) {
        const avg = averageEmbedding(embeddings);
        await db.from('topics').update({ embedding: formatVector(avg) }).eq('id', topicId);
      }
    }
  }

  return result;
}

// ── Step 2: YouTube search for starved topics ─────────────────────────

/**
 * For insufficient topics still under 5 videos AND created > 3 days ago,
 * search YouTube with the topic label. Videos found go through the same
 * similarity check (>= 0.72) before attachment.
 * Cap: EMERGING_SEARCHES_PER_NIGHT (default 15, 0 = disabled).
 */
export async function searchForEmergingTopics(
  db: SupabaseClient,
  embedder: EmbeddingProvider,
  deadlineMs: number,
  currentQuotaUsed: number,
): Promise<EmergingSearchResult> {
  const maxSearches = parseInt(process.env.EMERGING_SEARCHES_PER_NIGHT ?? '15', 10);
  if (maxSearches <= 0) {
    return { searchesPerformed: 0, videosFound: 0, videosAttached: 0, quotaUsed: 0 };
  }

  const result: EmergingSearchResult = {
    searchesPerformed: 0, videosFound: 0, videosAttached: 0, quotaUsed: 0,
  };
  const softLimit = getQuotaSoftLimit();
  let quotaUsed = currentQuotaUsed;

  const insufficientTopics = await loadInsufficientTopics(db);
  if (insufficientTopics.length === 0) return result;

  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();

  // Filter: created > 3 days ago
  const candidates = insufficientTopics.filter((t) => t.created_at < threeDaysAgo);
  if (candidates.length === 0) return result;

  // Count videos per topic, keep only those with < 5
  interface StarvedTopic extends InsufficientTopic { videoCount: number; medianViews: number }
  const starved: StarvedTopic[] = [];

  for (const topic of candidates) {
    const { count } = await db
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topic.id);

    if ((count ?? 0) >= 5) continue;

    // Get median views for prioritization
    const { data: vids } = await db
      .from('videos')
      .select('id')
      .eq('topic_id', topic.id);

    let medianViews = 0;
    if (vids?.length) {
      const { data: snaps } = await db
        .from('video_snapshots')
        .select('video_id, views')
        .in('video_id', vids.map((v) => v.id))
        .order('captured_at', { ascending: false });

      const viewsByVid = new Map<string, number>();
      for (const s of snaps ?? []) {
        if (!viewsByVid.has(s.video_id)) viewsByVid.set(s.video_id, s.views ?? 0);
      }
      const views = [...viewsByVid.values()].sort((a, b) => a - b);
      if (views.length > 0) {
        const mid = Math.floor(views.length / 2);
        medianViews = views[mid];
      }
    }

    starved.push({ ...topic, videoCount: count ?? 0, medianViews });
  }

  if (starved.length === 0) return result;

  // Sort by median views descending (prioritize topics with highest-viewed existing videos)
  starved.sort((a, b) => b.medianViews - a.medianViews);

  // Channel set for fast lookup
  const { data: channels } = await db.from('channels').select('id');
  const followedChannelIds = new Set((channels ?? []).map((c) => c.id));

  for (const topic of starved) {
    if (Date.now() >= deadlineMs) break;
    if (result.searchesPerformed >= maxSearches) break;
    if (quotaUsed + 100 > softLimit) break;

    try {
      // Search both medium and long durations
      for (const duration of ['medium', 'long'] as const) {
        if (result.searchesPerformed >= maxSearches) break;
        if (quotaUsed + 100 > softLimit) break;
        if (Date.now() >= deadlineMs) break;

        const search = await searchSingle(topic.label, {
          publishedAfter: ninetyDaysAgo,
          videoDuration: duration,
        });
        result.searchesPerformed++;
        result.quotaUsed += search.quotaUsed;
        quotaUsed += search.quotaUsed;
        result.videosFound += search.results.length;

        for (const sr of search.results) {
          // Check if video already in our videos table
          const { data: existing } = await db
            .from('videos')
            .select('id, topic_id, title_embedding')
            .eq('id', sr.videoId)
            .maybeSingle();

          if (existing) {
            if (existing.topic_id) continue; // Already attached to something

            // Already in DB — check similarity
            const videoEmb = parseEmbedding(existing.title_embedding);
            if (videoEmb.length === 0) continue;
            const sim = cosineSimilarity(videoEmb, topic.embedding);
            if (sim >= ATTACH_THRESHOLD) {
              await db.from('videos').update({ topic_id: topic.id }).eq('id', sr.videoId);
              result.videosAttached++;
            }
          } else if (followedChannelIds.has(sr.channelId)) {
            // Video from a followed channel — insert, embed, check similarity
            const { error } = await db.from('videos').upsert({
              id: sr.videoId,
              workspace_id: '00000000-0000-0000-0000-000000000001',
              channel_id: sr.channelId,
              title: sr.title,
              published_at: sr.publishedAt,
            }, { onConflict: 'id' });
            if (error) continue;

            try {
              const [emb] = await embedder.embed([sr.title], 'document');
              const formatted = formatVector(emb);
              await db.from('videos').update({ title_embedding: formatted }).eq('id', sr.videoId);

              const sim = cosineSimilarity(emb, topic.embedding);
              if (sim >= ATTACH_THRESHOLD) {
                const { error: attachError } = await db.from('videos').update({ topic_id: topic.id }).eq('id', sr.videoId);
                if (attachError) console.error('[enrich] attach failed', sr.videoId, attachError.message);
                else result.videosAttached++;
              }
            } catch {
              // Embedding failed — video stays for next embed pass
            }
          }
          // Vidéos de chaînes pas encore suivies : voir plus bas (chaînes candidates).
        }

        // Chaînes pas encore suivies dont une vidéo correspond au sujet : proposées comme chaînes candidates.
        // Le tri de nuit (niche détectée, taille, format) décide ensuite de les ajouter au catalogue ;
        // une fois suivies, leurs vidéos sont collectées et rattachées au sujet.
        const outside = search.results.filter((sr) => sr.channelId && !followedChannelIds.has(sr.channelId) && sr.title);
        if (outside.length) {
          try {
            const embs = await embedder.embed(outside.map((o) => o.title), 'document');
            const matched = new Map<string, string>();
            outside.forEach((o, i) => {
              if (cosineSimilarity(embs[i], topic.embedding) >= ATTACH_THRESHOLD) matched.set(o.channelId, o.channelTitle ?? '');
            });
            if (matched.size) {
              const { error: candErr } = await db.from('candidate_channels').upsert(
                [...matched.entries()].map(([id, title]) => ({
                  id,
                  title: title || null,
                  discovered_via: 'emerging_search',
                  source_topic_id: topic.id,
                  niche_id: topic.niche_id,
                  status: 'pending',
                })),
                { onConflict: 'id', ignoreDuplicates: true },
              );
              if (!candErr) result.channelsProposed = (result.channelsProposed ?? 0) + matched.size;
            }
          } catch {
            // embeddings indisponibles : on réessaiera à la prochaine recherche
          }
        }
      }
    } catch (err) {
      console.error(`  Emerging search error for "${topic.label}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return result;
}
