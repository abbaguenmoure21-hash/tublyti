import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { buildDigestData } from '@/lib/services/digest';
import { buildDigestHtml, sendDigestEmail } from '@/lib/email/digest-email';
import { timingSafeCompare } from '@/lib/auth/timing-safe';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!timingSafeCompare(authHeader ?? '', `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tublyti.vercel.app';

  try {
    const data = await buildDigestData(db);
    const html = buildDigestHtml(data, appUrl);
    const result = await sendDigestEmail(html);

    return NextResponse.json({
      ok: result.ok,
      blocksCount: data.blocks.length,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Digest cron]', message);
    return NextResponse.json({ error: 'Internal error during digest job.' }, { status: 500 });
  }
}
