/**
 * Aggregate old video_snapshots into video_stats_weekly rows.
 * Keeps daily snapshots for the last 30 days, compresses older ones.
 *
 * Usage: npx tsx scripts/aggregate-snapshots.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const RETENTION_DAYS = 30;
const BATCH_SIZE = 500;

function isoWeekStart(d: Date): string {
  const day = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey);
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();

  console.log(`Aggregating snapshots older than ${cutoff.slice(0, 10)}...`);

  let totalAggregated = 0;
  let totalDeleted = 0;
  let offset = 0;

  // Process in batches
  while (true) {
    const { data: snapshots, error } = await db
      .from('video_snapshots')
      .select('id, video_id, views, likes, comments, captured_at')
      .lt('captured_at', cutoff)
      .order('captured_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Error fetching snapshots:', error.message);
      break;
    }
    if (!snapshots?.length) break;

    // Group by video_id + week
    const weeklyMap = new Map<string, {
      video_id: string;
      week_start: string;
      views: number;
      likes: number;
      comments: number;
      count: number;
    }>();

    const snapshotIds: number[] = [];

    for (const snap of snapshots) {
      const weekStart = isoWeekStart(new Date(snap.captured_at));
      const key = `${snap.video_id}::${weekStart}`;

      const existing = weeklyMap.get(key);
      if (existing) {
        // Keep max values (most recent snapshot in the week)
        existing.views = Math.max(existing.views, snap.views ?? 0);
        existing.likes = Math.max(existing.likes, snap.likes ?? 0);
        existing.comments = Math.max(existing.comments, snap.comments ?? 0);
        existing.count++;
      } else {
        weeklyMap.set(key, {
          video_id: snap.video_id,
          week_start: weekStart,
          views: snap.views ?? 0,
          likes: snap.likes ?? 0,
          comments: snap.comments ?? 0,
          count: 1,
        });
      }
      snapshotIds.push(snap.id);
    }

    // Upsert weekly aggregates
    for (const entry of weeklyMap.values()) {
      const { error: upsertError } = await db.from('video_stats_weekly').upsert({
        video_id: entry.video_id,
        week_start: entry.week_start,
        views: entry.views,
        likes: entry.likes,
        comments: entry.comments,
        snapshots_count: entry.count,
      }, { onConflict: 'video_id,week_start' });

      if (upsertError) {
        console.error(`Upsert error for ${entry.video_id} week ${entry.week_start}: ${upsertError.message}`);
      }
    }

    // Delete aggregated snapshots
    for (let i = 0; i < snapshotIds.length; i += 100) {
      const batch = snapshotIds.slice(i, i + 100);
      const { error: deleteError } = await db
        .from('video_snapshots')
        .delete()
        .in('id', batch);
      if (deleteError) {
        console.error(`Delete error: ${deleteError.message}`);
      }
    }

    totalAggregated += weeklyMap.size;
    totalDeleted += snapshotIds.length;
    console.log(`  Batch: ${snapshots.length} snapshots → ${weeklyMap.size} weekly rows, ${snapshotIds.length} deleted`);

    if (snapshots.length < BATCH_SIZE) break;
    // Don't increment offset — we deleted the rows we just processed
  }

  console.log(`\nDone. Aggregated: ${totalAggregated} weekly rows, Deleted: ${totalDeleted} snapshots`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
