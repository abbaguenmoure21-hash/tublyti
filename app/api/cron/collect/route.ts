import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { RealYouTubeClient } from '@/lib/youtube/client';
import { SupabaseJobRunner } from '@/lib/jobs/supabase-runner';
import { runCollect } from '@/lib/youtube/collect';
import { collectSignals } from '@/lib/signals/collect-signals';
import { runClustering } from '@/lib/topics/cluster-service';
import { runYouTubeSearch } from '@/lib/youtube/search';
import { discoverChannels, retrieveDiscoveryBatches } from '@/lib/youtube/discover-channels';
import { computeChannelEmbeddings } from '@/lib/youtube/channel-embeddings';
import { VoyageEmbeddingProvider } from '@/lib/providers/voyage-embeddings';
import { FakeEmbeddingProvider } from '@/lib/providers/embeddings';
import { ResendAlertSender, ConsoleAlertSender } from '@/lib/email/resend-alerts';
import { isCronAuthorized } from '@/lib/auth/cron';

// Long-running (YouTube collection, AI batches, Gemini video analysis): explicit Vercel limit.
// Internal deadlines (MAX_DURATION_MS = 4 min) keep >= 20 s of margin for finish/releaseLock.
export const maxDuration = 300;

const MAX_DURATION_MS = 4 * 60 * 1000; // 4 minutes

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!isCronAuthorized(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  const runner = new SupabaseJobRunner(db);
  runner.setAlertSender(
    process.env.RESEND_API_KEY ? new ResendAlertSender() : new ConsoleAlertSender(),
  );

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
    let channelEmbeddings = { channelsEmbedded: 0 };
    if (!result.stoppedByTimeout && !result.stoppedByQuota) {
      const embedder = process.env.VOYAGE_API_KEY
        ? new VoyageEmbeddingProvider()
        : new FakeEmbeddingProvider();
      clustering = await runClustering(db, embedder, deadline);

      // Channel embeddings for similarity search
      if (Date.now() < deadline) {
        channelEmbeddings = await computeChannelEmbeddings(db, embedder, deadline);
      }
    }

    // YouTube search for videos outside followed channels
    let search = { searchesPerformed: 0, videosDiscovered: 0 };
    if (Date.now() < deadline) {
      search = await runYouTubeSearch(db, deadline, result.quotaUsed);
    }

    // Channel discovery (weekly, max 30 searches) + retrieve pending faceless batches
    let discovery = { searchesPerformed: 0, channelsDiscovered: 0, facelessEstimated: 0 };
    let facelessUpdated = 0;
    if (Date.now() < deadline) {
      facelessUpdated = await retrieveDiscoveryBatches(db);
      const discoveryResult = await discoverChannels(db, deadline, result.quotaUsed + search.searchesPerformed * 100);
      discovery = {
        searchesPerformed: discoveryResult.searchesPerformed,
        channelsDiscovered: discoveryResult.channelsDiscovered,
        facelessEstimated: discoveryResult.facelessEstimated,
      };
    }

    await runner.finish(job.id, {
      quotaUsed: result.quotaUsed,
      itemsProcessed:
        result.channelsUpdated + result.videosDiscovered + result.snapshotsTaken
        + signals.trendPointsCollected + signals.socialPointsCollected + signals.ytViewPointsCollected
        + clustering.videosEmbedded + clustering.videosAttached + search.videosDiscovered
        + discovery.channelsDiscovered,
    });

    return NextResponse.json({ ok: true, ...result, ...signals, ...clustering, ...channelEmbeddings, ...search, discovery, facelessUpdated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Cron collect]', message);
    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: 0,
      error: message,
    });
    return NextResponse.json({ error: 'Internal error during collect job.' }, { status: 500 });
  } finally {
    await runner.releaseLock('collect');
  }
}
