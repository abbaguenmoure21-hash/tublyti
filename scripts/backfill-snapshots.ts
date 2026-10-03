/**
 * Backfill video_snapshots for all videos < 90d that have no snapshot.
 * Uses YouTube videos.list in batches of 50 (1 quota per batch).
 * Writes a job row for traceability.
 *
 * Usage:
 *   npx tsx scripts/backfill-snapshots.ts
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
import { SupabaseJobRunner } from '../lib/jobs/supabase-runner';

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const yt = new RealYouTubeClient(process.env.YOUTUBE_API_KEY!, 8000);
  const runner = new SupabaseJobRunner(db);
  const job = await runner.start('backfill-snapshots');

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  try {
    // Get all video IDs with snapshots
    const snappedSet = new Set<string>();
    let snapOffset = 0;
    while (true) {
      const { data } = await db.from('video_snapshots')
        .select('video_id')
        .range(snapOffset, snapOffset + 999);
      if (!data?.length) break;
      for (const s of data) snappedSet.add(s.video_id);
      if (data.length < 1000) break;
      snapOffset += data.length;
    }

    // Get all videos < 90d without snapshot
    const toFetch: string[] = [];
    let vidOffset = 0;
    while (true) {
      const { data: vids } = await db.from('videos')
        .select('id')
        .gte('published_at', cutoff)
        .range(vidOffset, vidOffset + 999);
      if (!vids?.length) break;
      for (const v of vids) {
        if (!snappedSet.has(v.id)) toFetch.push(v.id);
      }
      vidOffset += vids.length;
      if (vids.length < 1000) break;
    }

    console.log(`Videos < 90d sans snapshot: ${toFetch.length}`);
    console.log(`Quota estimé: ${Math.ceil(toFetch.length / 50)} units\n`);

    let totalSnaps = 0;
    for (let i = 0; i < toFetch.length; i += 50) {
      const batch = toFetch.slice(i, i + 50);
      const snapshots = await yt.getVideoSnapshots(batch);

      for (const snap of snapshots) {
        await db.from('video_snapshots').upsert(
          {
            video_id: snap.videoId,
            captured_at: now,
            views: snap.views,
            likes: snap.likes,
            comments: snap.comments,
          },
          { onConflict: 'video_id,captured_at' },
        );
        totalSnaps++;
      }

      if ((i / 50 + 1) % 10 === 0 || i + 50 >= toFetch.length) {
        console.log(`  ${Math.min(i + 50, toFetch.length)}/${toFetch.length} — Snapshots: ${totalSnaps} — Quota: ${yt.getQuotaUsed()}`);
      }
    }

    console.log(`\n=== DONE ===`);
    console.log(`Snapshots created: ${totalSnaps}`);
    console.log(`YouTube quota used: ${yt.getQuotaUsed()}`);

    await runner.finish(job.id, { quotaUsed: yt.getQuotaUsed(), itemsProcessed: totalSnaps });
  } catch (err) {
    await runner.finish(job.id, {
      quotaUsed: yt.getQuotaUsed(),
      itemsProcessed: 0,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

main().catch(console.error);
