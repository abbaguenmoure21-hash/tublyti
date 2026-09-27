import type { AlertSender, AlertPayload } from './alerts';

function buildHtml(payload: AlertPayload): string {
  const buttonHtml = payload.actionUrl
    ? `<p style="margin-top:20px;">
        <a href="${payload.actionUrl}"
           style="display:inline-block;padding:10px 24px;background:#4f46e5;color:#fff;
                  text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
          ${payload.actionLabel ?? 'Voir le detail'}
        </a>
      </p>`
    : '';

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                max-width:500px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;font-size:18px;color:#111;">${payload.subject}</h2>
      <p style="color:#444;font-size:14px;line-height:1.6;white-space:pre-wrap;">${payload.body}</p>
      ${buttonHtml}
      <p style="margin-top:24px;font-size:11px;color:#999;">TubLyTI — alerte automatique</p>
    </div>
  `.trim();
}

export class ResendAlertSender implements AlertSender {
  private apiKey: string;
  private to: string;
  private from: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY ?? '';
    this.to = process.env.ALERT_EMAIL ?? '';
    this.from = process.env.ALERT_FROM ?? 'TubLyTI <alerts@tublyti.com>';
  }

  async send(payload: AlertPayload): Promise<void> {
    if (!this.apiKey || !this.to) {
      console.warn(`[Alert] ${payload.kind}: ${payload.subject} (no Resend config, skipping)`);
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [this.to],
        subject: `[TubLyTI] ${payload.subject}`,
        html: buildHtml(payload),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.error(`Resend error ${res.status}: ${await res.text()}`);
    }
  }
}

export class ConsoleAlertSender implements AlertSender {
  readonly sent: AlertPayload[] = [];

  async send(payload: AlertPayload): Promise<void> {
    console.log(`[Alert] ${payload.kind}: ${payload.subject}`);
    this.sent.push(payload);
  }
}
