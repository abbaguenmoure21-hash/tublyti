import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { SupabaseJobRunner } from '@/lib/jobs/supabase-runner';
import { runClassify } from '@/lib/nlp/classify-service';
import { extractTitlePatterns } from '@/lib/nlp/title-patterns';
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

  if (await runner.isLocked('classify')) {
    return NextResponse.json(
      { error: 'Classify job already running' },
      { status: 409 },
    );
  }

  const locked = await runner.acquireLock('classify');
  if (!locked) {
    return NextResponse.json(
      { error: 'Could not acquire lock' },
      { status: 409 },
    );
  }

  const job = await runner.start('classify');
  const deadline = Date.now() + MAX_DURATION_MS;

  try {
    const result = await runClassify(db, deadline);

    // Extract title patterns from outlier videos (Batch API)
    let titlePatternResult;
    try {
      titlePatternResult = await extractTitlePatterns(db);
    } catch (err) {
      console.error('[Classify] Title pattern extraction failed:', err instanceof Error ? err.message : err);
    }

    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: result.labelsStored + result.commentsSubmitted + (titlePatternResult?.patternsStored ?? 0),
    });

    return NextResponse.json({ ok: true, ...result, titlePatterns: titlePatternResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Cron classify]', message);
    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: 0,
      error: message,
    });
    return NextResponse.json({ error: 'Internal error during classify job.' }, { status: 500 });
  } finally {
    await runner.releaseLock('classify');
  }
}
