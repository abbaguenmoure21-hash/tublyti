import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { SupabaseJobRunner } from '@/lib/jobs/supabase-runner';
import { runScore } from '@/lib/scoring/score-service';
import { ResendAlertSender, ConsoleAlertSender } from '@/lib/email/resend-alerts';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  const runner = new SupabaseJobRunner(db);

  if (await runner.isLocked('score')) {
    return NextResponse.json(
      { error: 'Score job already running' },
      { status: 409 },
    );
  }

  const locked = await runner.acquireLock('score');
  if (!locked) {
    return NextResponse.json(
      { error: 'Could not acquire lock' },
      { status: 409 },
    );
  }

  const job = await runner.start('score');

  try {
    const alertSender = process.env.RESEND_API_KEY
      ? new ResendAlertSender()
      : new ConsoleAlertSender();

    const result = await runScore(db, alertSender);

    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: result.topicsScored,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: 0,
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await runner.releaseLock('score');
  }
}
