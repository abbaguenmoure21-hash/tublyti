import { NextRequest, NextResponse } from 'next/server';
import { ResendAlertSender, ConsoleAlertSender } from '@/lib/email/resend-alerts';
import { isCronAuthorized } from '@/lib/auth/cron';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!isCronAuthorized(authHeader)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sender = process.env.RESEND_API_KEY
    ? new ResendAlertSender()
    : new ConsoleAlertSender();

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://tublyti.vercel.app').replace(/\/+$/, '');

  await sender.send({
    kind: 'test',
    subject: 'Alerte test',
    body: 'Ceci est une alerte de test envoyee depuis TubLyTI. Si vous recevez cet email, la configuration Resend fonctionne correctement.',
    actionUrl: `${baseUrl}/admin/jobs`,
    actionLabel: 'Retour aux jobs',
  });

  return NextResponse.json({ ok: true, method: process.env.RESEND_API_KEY ? 'resend' : 'console' });
}
