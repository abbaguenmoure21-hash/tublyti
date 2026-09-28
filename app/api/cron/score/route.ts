import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { SupabaseJobRunner } from '@/lib/jobs/supabase-runner';
import { runScore } from '@/lib/scoring/score-service';
import { ResendAlertSender, ConsoleAlertSender } from '@/lib/email/resend-alerts';
import { timingSafeCompare } from '@/lib/auth/timing-safe';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!timingSafeCompare(authHeader ?? '', `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  const runner = new SupabaseJobRunner(db);
  const alertSender = process.env.RESEND_API_KEY
    ? new ResendAlertSender()
    : new ConsoleAlertSender();
  runner.setAlertSender(alertSender);

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
    const result = await runScore(db, alertSender);

    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: result.topicsScored,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Cron score]', message);
    await runner.finish(job.id, {
      quotaUsed: 0,
      itemsProcessed: 0,
      error: message,
    });
    return NextResponse.json({ error: 'Internal error during score job.' }, { status: 500 });
  } finally {
    await runner.releaseLock('score');
  }
}
