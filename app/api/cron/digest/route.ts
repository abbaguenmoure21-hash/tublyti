import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendAllDigests } from '@/lib/services/digest-send';
import { timingSafeCompare } from '@/lib/auth/timing-safe';

// Long-running (YouTube collection, AI batches, Gemini video analysis): explicit Vercel limit.
// Internal deadlines (MAX_DURATION_MS = 4 min) keep >= 20 s of margin for finish/releaseLock.
export const maxDuration = 300;

/** Envoi hebdomadaire du résumé : un e-mail par compte (ses chaînes, ses vidéos, ses alertes). */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!timingSafeCompare(authHeader ?? '', `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sendAllDigests(createServiceClient());
    return NextResponse.json({ ok: result.failed === 0, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Digest cron]', message);
    return NextResponse.json({ error: 'Internal error during digest job.' }, { status: 500 });
  }
}
