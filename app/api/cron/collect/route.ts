import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { RealYouTubeClient } from '@/lib/youtube/client';
import { SupabaseJobRunner } from '@/lib/jobs/supabase-runner';
import { runCollect } from '@/lib/youtube/collect';
import { collectSignals } from '@/lib/signals/collect-signals';
import { runClustering } from '@/lib/topics/cluster-service';
import { runYouTubeSearch } from '@/lib/youtube/search';
import { VoyageEmbeddingProvider } from '@/lib/providers/voyage-embeddings';
import { FakeEmbeddingProvider } from '@/lib/providers/embeddings';

const MAX_DURATION_MS = 4 * 60 * 1000; // 4 minutes

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  const runner = new SupabaseJobRunner(db);

  // Check lock
  if (await runner.isLocked('collect')) {
    return NextResponse.json(
      { error: 'Collect job already running' },
      { status: 409 },
    );
  }

  // Acquire lock & start job
  const locked = await runner.acquireLock('collect');
  if (!locked) {
    return NextResponse.json(
      { error: 'Could not acquire lock' },
      { status: 409 },
    );
  }

  const job = await runner.start('collect');
  const deadline = Date.now() + MAX_DURATION_MS;

  try {
    // Signals first (cheap, no YouTube quota), then YouTube collection
    const signals = await collectSignals(db, deadline);

    const yt = new RealYouTubeClient();
    const result = await runCollect(db, yt, deadline);

    // Embedding + topic clustering if time permits
    let clustering = { videosEmbedded: 0, anglesEmbedded: 0, videosAttached: 0, topicsProposed: 0 };
    if (!result.stoppedByTimeout && !result.stoppedByQuota) {
      const embedder = process.env.VOYAGE_API_KEY
        ? new VoyageEmbeddingProvider()
        : new FakeEmbeddingProvider();
      clustering = await runClustering(db, embedder, deadline);
    }

    // YouTube search for videos outside followed channels
    let search = { searchesPerformed: 0, videosDiscovered: 0 };
    if (Date.now() < deadline) {
      search = await runYouTubeSearch(db, deadline, result.quotaUsed);
    }

    await runner.finish(job.id, {
      quotaUsed: result.quotaUsed,
      itemsProcessed:
        result.channelsUpdated + result.videosDiscovered + result.snapshotsTaken
        + signals.trendPointsCollected + signals.socialPointsCollected + signals.ytViewPointsCollected
        + clustering.videosEmbedded + clustering.videosAttached + search.videosDiscovered,
    });

    return NextResponse.json({ ok: true, ...result, ...signals, ...clustering, ...search });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: 0,
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await runner.releaseLock('collect');
  }
}
