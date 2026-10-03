/**
 * Collect top comments for scored topics' longest videos.
 *
 * For each scored topic, picks top 3 longest videos and fetches
 * up to 100 comments each via YouTube API.
 *
 * Usage:
 *   npx tsx scripts/collect-comments.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

import { RealYouTubeClient } from '../lib/youtube/client';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const yt = new RealYouTubeClient(process.env.YOUTUBE_API_KEY!, 8000);
  const today = new Date().toISOString().slice(0, 10);

  // Get scored topics (confidence != insufficient)
  const { data: scoredTopics } = await db
    .from('topic_scores')
    .select('topic_id')
    .eq('scored_at', today)
    .neq('confidence', 'insufficient');
  const topicIds = (scoredTopics ?? []).map((s: { topic_id: string }) => s.topic_id);
  console.log('Scored topics:', topicIds.length);

  // Get videos for these topics, longest first
  const { data: videos } = await db
    .from('videos')
    .select('id, topic_id, duration_s, title')
    .in('topic_id', topicIds)
    .not('duration_s', 'is', null)
    .order('duration_s', { ascending: false });

  // Pick top 3 longest per topic
  const targetVideos: Array<{ id: string; topic_id: string; duration_s: number; title: string }> = [];
  const seen = new Map<string, number>();
  for (const v of videos ?? []) {
    const count = seen.get(v.topic_id) ?? 0;
    if (count < 3) {
      targetVideos.push(v);
      seen.set(v.topic_id, count + 1);
    }
  }
  console.log('Target videos (top 3 per topic):', targetVideos.length);

  let totalComments = 0;
  let videosProcessed = 0;
  let errors = 0;

  for (const video of targetVideos) {
    try {
      const comments = await yt.getCommentThreads(video.id, 100, 1);

      if (comments.length > 0) {
        const rows = comments.map((c) => ({
          id: c.id,
          workspace_id: WORKSPACE_ID,
          video_id: c.videoId,
          text: c.text,
          like_count: c.likeCount,
          published_at: c.publishedAt,
        }));

        const { error } = await db.from('comments').upsert(rows, { onConflict: 'id' });
        if (error) {
          console.error('  DB error for', video.id, ':', error.message);
          errors++;
        } else {
          totalComments += comments.length;
        }
      }

      videosProcessed++;
      if (videosProcessed % 20 === 0) {
        console.log(
          `  Progress: ${videosProcessed}/${targetVideos.length} — Comments: ${totalComments} — Quota: ${yt.getQuotaUsed()}`,
        );
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        console.error('  Error for', video.id, ':', (err as Error).message?.slice(0, 80));
      }
    }
  }

  console.log('\n=== DONE ===');
  console.log('Videos processed:', videosProcessed);
  console.log('Comments collected:', totalComments);
  console.log('Errors:', errors);
  console.log('YouTube quota used:', yt.getQuotaUsed());
}

main().catch(console.error);
