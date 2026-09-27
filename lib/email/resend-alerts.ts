import type { AlertSender, AlertPayload } from './alerts';

export class ResendAlertSender implements AlertSender {
  private apiKey: string;
  private to: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY ?? '';
    this.to = process.env.ALERT_EMAIL ?? '';
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
        from: 'TubLyTI <alerts@tublyti.com>',
        to: [this.to],
        subject: `[TubLyTI] ${payload.subject}`,
        text: payload.body,
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
