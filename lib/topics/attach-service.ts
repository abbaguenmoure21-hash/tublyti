import { SupabaseClient } from '@supabase/supabase-js';
import { decideScan, isMissingColumn, loadTopicScanState, markChecked, saveTopicScanState, type ScanPlan } from './scan-state';

const SAME_NICHE_THRESHOLD = 0.66;
const CROSS_NICHE_THRESHOLD = 0.75;
const PAGE_SIZE = 500;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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

function formatVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

interface TopicRef {
  id: string;
  nicheId: string;
  embedding: number[];
}

/**
 * Attach ALL unattached videos (< 90 days, has embedding) to the best
 * matching topic using a two-tier strategy:
 *   1. Same-niche match ≥ 0.68 (relaxed — same domain tolerates title variation)
 *   2. Cross-niche match ≥ 0.75 (strict — higher bar compensates niche mismatch)
 * Same-niche match is preferred when both pass their threshold.
 * Also recalculates topic embeddings after attachment.
 */
export async function runAttachAll(
  db: SupabaseClient,
  deadlineMs: number,
  opts: { incremental?: boolean } = {},
): Promise<{ attached: number; orphans: number; scanned?: number; mode?: ScanPlan['mode'] }> {
  // Load topics with embeddings
  const { data: topics } = await db
    .from('topics')
    .select('id, niche_id, embedding')
    .in('status', ['proposed', 'active', 'in_production'])
    .not('embedding', 'is', null);

  const topicList: TopicRef[] = (topics ?? [])
    .map((t) => ({
      id: t.id as string,
      nicheId: t.niche_id as string,
      embedding: parseEmbedding(t.embedding),
    }))
    .filter((t) => t.embedding.length > 0);

  if (topicList.length === 0) return { attached: 0, orphans: 0 };

  // Channel → niche mapping
  // Paginated (Supabase caps at 1 000 rows: channels beyond made their videos « orphans » for no reason).
  const channels: { id: string; niche_id: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('channels').select('id, niche_id').order('id').range(from, from + 999);
    if (error) throw new Error(`attach: read channels: ${error.message}`);
    channels.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const channelNiche = new Map(channels.map((c) => [c.id, c.niche_id]));

  // Incremental modes (nightly, scan-state.ts): 'incremental' = only never-compared videos;
  // 'added' = every orphan against the new topics only (never-compared ones against all); 'full' otherwise.
  const topicIds = topicList.map((t) => t.id);
  const prevState = opts.incremental ? await loadTopicScanState(db, 'attach_scan_state') : null;
  let plan: ScanPlan = opts.incremental ? decideScan(prevState, topicIds) : { mode: 'full' };
  let hasCheckedCol = Boolean(opts.incremental);
  const addedTopics = plan.mode === 'added' ? topicList.filter((t) => (plan as { added: Set<string> }).added.has(t.id)) : [];
  let scanned = 0;
  let stoppedByTimeout = false;

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  // Keyset pagination on id: attaching a video removes it from the `topic_id is null` filter, so the old
  // `offset += page` skipped as many unseen videos as had just been attached (and range() had no order).
  let lastId = '';
  let totalAttached = 0;
  let totalOrphans = 0;
  const touchedTopics = new Set<string>();

  const page = (onlyUnchecked: boolean) => {
    let q = db
      .from('videos')
      .select(hasCheckedCol ? 'id, channel_id, title_embedding, attach_checked_at' : 'id, channel_id, title_embedding')
      .is('topic_id', null)
      .not('title_embedding', 'is', null)
      .gte('published_at', cutoff)
      .gt('id', lastId);
    if (onlyUnchecked) q = q.is('attach_checked_at', null);
    return q.order('id').limit(PAGE_SIZE);
  };

  while (true) {
    if (Date.now() >= deadlineMs) { stoppedByTimeout = true; break; }
    let { data: rawVideos, error: vErr } = await page(plan.mode === 'incremental' && hasCheckedCol);
    if (vErr && hasCheckedCol && isMissingColumn(vErr.message, 'attach_checked_at')) {
      console.warn('  [attach] videos.attach_checked_at absent (migration 00033) — full scan');
      hasCheckedCol = false;
      plan = { mode: 'full' };
      ({ data: rawVideos, error: vErr } = await page(false));
    }
    if (vErr) throw new Error(`attach: read orphan videos: ${vErr.message}`);
    const videos = (rawVideos ?? []) as unknown as { id: string; channel_id: string; title_embedding: unknown; attach_checked_at?: string | null }[];

    if (!videos.length) break;
    scanned += videos.length;
    const toAttach = new Map<string, string[]>();

    for (const video of videos) {
      const videoEmb = parseEmbedding(video.title_embedding);
      if (videoEmb.length === 0) continue;

      const nicheId = channelNiche.get(video.channel_id);
      if (!nicheId) { totalOrphans++; continue; }

      // Find best same-niche and best cross-niche match
      let bestSameSim = 0;
      let bestSameTopicId: string | null = null;
      let bestCrossSim = 0;
      let bestCrossTopicId: string | null = null;

      // Already compared with the previous topics: only the new ones can change the answer.
      const candidates = plan.mode === 'added' && video.attach_checked_at ? addedTopics : topicList;
      for (const topic of candidates) {
        const sim = cosineSimilarity(videoEmb, topic.embedding);
        if (topic.nicheId === nicheId) {
          if (sim > bestSameSim) { bestSameSim = sim; bestSameTopicId = topic.id; }
        } else {
          if (sim > bestCrossSim) { bestCrossSim = sim; bestCrossTopicId = topic.id; }
        }
      }

      // Tier 1: same-niche ≥ 0.68 (preferred)
      const target = bestSameTopicId && bestSameSim >= SAME_NICHE_THRESHOLD
        ? bestSameTopicId
        // Tier 2: cross-niche ≥ 0.75 (fallback)
        : bestCrossTopicId && bestCrossSim >= CROSS_NICHE_THRESHOLD ? bestCrossTopicId : null;
      if (target) {
        const list = toAttach.get(target) ?? [];
        list.push(video.id);
        toAttach.set(target, list);
      } else {
        totalOrphans++;
      }
    }

    // One update per target topic (was one per video).
    for (const [topicId, ids] of toAttach) {
      const { error: upErr } = await db.from('videos').update({ topic_id: topicId }).in('id', ids);
      if (upErr) { console.error(`  [attach] update: ${upErr.message}`); continue; }
      totalAttached += ids.length;
      touchedTopics.add(topicId);
    }
    if (hasCheckedCol) await markChecked(db, videos.map((v) => v.id));

    lastId = videos[videos.length - 1]!.id;
    if (videos.length < PAGE_SIZE) break;
  }

  // Recalculate embeddings for all touched topics
  for (const topicId of Array.from(touchedTopics)) {
    const { data: members } = await db
      .from('videos')
      .select('title_embedding')
      .eq('topic_id', topicId)
      .not('title_embedding', 'is', null)
      .limit(200);

    if (!members?.length) continue;

    const embeddings = members
      .map((m) => parseEmbedding(m.title_embedding))
      .filter((e) => e.length > 0);

    if (embeddings.length === 0) continue;

    const avg = averageEmbedding(embeddings);
    await db.from('topics').update({ embedding: formatVector(avg) }).eq('id', topicId);
  }

  // A complete full scan resets the reference: next nights only compare new videos.
  // A complete pass updates the reference set of topics (a full one also resets the 7-day clock).
  if (opts.incremental && hasCheckedCol && plan.mode !== 'incremental' && !stoppedByTimeout) {
    await saveTopicScanState(db, 'attach_scan_state', topicIds, plan.mode === 'full', prevState);
  }
  const addedNote = plan.mode === 'added' ? ` against ${addedTopics.length} new topic(s)` : '';
  console.log(`  [attach] ${plan.mode} scan: ${scanned} orphan vectors read${addedNote}`);

  return { attached: totalAttached, orphans: totalOrphans, scanned, mode: plan.mode };
}
