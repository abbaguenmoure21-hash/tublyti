import type { DigestData, DigestNicheBlock, DigestAlertEvent } from '@/lib/services/digest';

const PHASE_LABELS: Record<number, string> = {
  0: 'Emergence',
  1: 'Viralite courte',
  2: 'Fenetre ideale',
  3: 'Saturation',
};

const PHASE_COLORS: Record<number, string> = {
  0: '#8459c3',
  1: '#cf7c00',
  2: '#0e9254',
  3: '#d33949',
};

function formatViews(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function renderTopTopics(topics: DigestNicheBlock['topTopics']): string {
  if (topics.length === 0) return '';
  const rows = topics
    .map(
      (t, i) =>
        `<tr>
          <td style="padding:6px 8px;font-size:13px;color:#5e636e;text-align:right;width:24px;">${i + 1}</td>
          <td style="padding:6px 8px;font-size:13px;color:#141822;">${t.label}</td>
          <td style="padding:6px 8px;font-size:13px;color:#141822;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${Math.round(t.mgi)}</td>
          <td style="padding:6px 8px;">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;color:${PHASE_COLORS[t.phase] ?? '#5e636e'};background:${PHASE_COLORS[t.phase] ?? '#5e636e'}15;">
              ${PHASE_LABELS[t.phase] ?? `Phase ${t.phase}`}
            </span>
          </td>
        </tr>`,
    )
    .join('');

  return `
    <h3 style="margin:16px 0 8px;font-size:14px;font-weight:600;color:#141822;">Top 5 sujets</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:1px solid #e1e3e7;">
          <th style="padding:6px 8px;font-size:11px;color:#5e636e;text-align:right;">#</th>
          <th style="padding:6px 8px;font-size:11px;color:#5e636e;text-align:left;">Sujet</th>
          <th style="padding:6px 8px;font-size:11px;color:#5e636e;text-align:right;">MGI</th>
          <th style="padding:6px 8px;font-size:11px;color:#5e636e;text-align:left;">Phase</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderNewPhase2(topics: DigestNicheBlock['newPhase2']): string {
  if (topics.length === 0) return '';
  const items = topics
    .map(
      (t) =>
        `<li style="padding:4px 0;font-size:13px;color:#141822;">
          <span style="color:#0e9254;font-weight:600;">&#x25CF;</span> ${t.label}
          <span style="color:#5e636e;font-size:12px;">(MGI ${Math.round(t.mgi)})</span>
        </li>`,
    )
    .join('');

  return `
    <h3 style="margin:16px 0 8px;font-size:14px;font-weight:600;color:#0e9254;">Passes en phase 2 cette semaine</h3>
    <ul style="margin:0;padding:0 0 0 16px;list-style:none;">${items}</ul>`;
}

function renderPublishedVideos(videos: DigestNicheBlock['publishedVideos']): string {
  if (videos.length === 0) return '';
  const rows = videos
    .map(
      (v) =>
        `<tr>
          <td style="padding:6px 8px;font-size:13px;color:#141822;">${v.label}</td>
          <td style="padding:6px 8px;font-size:12px;color:#5e636e;">${v.angleTitle}</td>
          <td style="padding:6px 8px;font-size:13px;color:#5e636e;text-align:right;font-variant-numeric:tabular-nums;">J+${v.daysSincePublish}</td>
          <td style="padding:6px 8px;font-size:13px;color:#141822;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;">${formatViews(v.views)}</td>
        </tr>`,
    )
    .join('');

  return `
    <h3 style="margin:16px 0 8px;font-size:14px;font-weight:600;color:#141822;">Videos publiees</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:1px solid #e1e3e7;">
          <th style="padding:6px 8px;font-size:11px;color:#5e636e;text-align:left;">Sujet</th>
          <th style="padding:6px 8px;font-size:11px;color:#5e636e;text-align:left;">Angle</th>
          <th style="padding:6px 8px;font-size:11px;color:#5e636e;text-align:right;">Age</th>
          <th style="padding:6px 8px;font-size:11px;color:#5e636e;text-align:right;">Vues</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderNicheBlock(block: DigestNicheBlock): string {
  const channelLabel = block.ownerChannel
    ? `<span style="font-size:12px;color:#5e636e;font-weight:400;margin-left:8px;">${block.ownerChannel}</span>`
    : '';

  return `
    <div style="margin-bottom:24px;padding:20px;background:#ffffff;border:1px solid #e1e3e7;border-radius:10px;">
      <h2 style="margin:0 0 4px;font-size:16px;font-weight:600;color:#141822;">${block.nicheName}${channelLabel}</h2>
      ${renderTopTopics(block.topTopics)}
      ${renderNewPhase2(block.newPhase2)}
      ${renderPublishedVideos(block.publishedVideos)}
    </div>`;
}

const RULE_TYPE_LABELS: Record<string, string> = {
  phase_change: 'Changement de phase',
  collection_phase_change: 'Favori : changement de phase',
  video_outlier: 'Video outlier',
  window_closing: 'Fenetre qui se ferme',
};

function renderAlertEvents(events: DigestAlertEvent[], appUrl: string): string {
  if (events.length === 0) return '';

  const items = events
    .map((e) => {
      const topicId = e.payload.topic_id as string | undefined;
      const link = topicId
        ? ` <a href="${appUrl}/topics/${topicId}" style="color:#524fdd;text-decoration:none;font-size:12px;">Voir →</a>`
        : '';
      const typeLabel = RULE_TYPE_LABELS[e.ruleType] ?? e.ruleType;
      const time = new Date(e.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

      return `<tr>
        <td style="padding:6px 8px;font-size:11px;color:#5e636e;white-space:nowrap;">${time}</td>
        <td style="padding:6px 8px;">
          <span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;color:#524fdd;background:#524fdd15;">${typeLabel}</span>
        </td>
        <td style="padding:6px 8px;font-size:13px;color:#141822;">${e.ruleLabel}${link}</td>
      </tr>`;
    })
    .join('');

  return `
    <div style="margin-bottom:24px;padding:20px;background:#ffffff;border:1px solid #e1e3e7;border-radius:10px;">
      <h2 style="margin:0 0 12px;font-size:16px;font-weight:600;color:#141822;">Alertes de la semaine</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${items}</tbody>
      </table>
    </div>`;
}

export function buildDigestHtml(data: DigestData, appUrl: string): string {
  const dateStr = new Date(data.generatedAt).toLocaleDateString('fr-FR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const nicheBlocks = data.blocks.map(renderNicheBlock).join('');
  const alertSection = renderAlertEvents(data.alertEvents, appUrl);

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#141822;">Digest hebdomadaire</h1>
      <p style="margin:0;font-size:13px;color:#5e636e;">${dateStr}</p>
    </div>

    ${alertSection}

    ${nicheBlocks}

    ${data.blocks.length === 0 && data.alertEvents.length === 0 ? '<p style="text-align:center;font-size:14px;color:#5e636e;padding:32px 0;">Aucun sujet score cette semaine.</p>' : ''}

    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/dashboard"
         style="display:inline-block;padding:12px 32px;background:#524fdd;color:#ffffff;
                text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
        Ouvrir TubLyTI
      </a>
    </div>

    <p style="text-align:center;margin-top:24px;font-size:11px;color:#999;">
      TubLyTI — digest automatique du dimanche
    </p>
  </div>
</body>
</html>`.trim();
}

export async function sendDigestEmail(html: string, recipient?: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = recipient || process.env.ALERT_EMAIL;
  const from = process.env.ALERT_FROM ?? 'TubLyTI <alerts@tublyti.com>';

  if (!apiKey || !to) {
    console.warn('[Digest] No Resend config, skipping email.');
    return { ok: false, error: 'Resend non configure.' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: '[TubLyTI] Digest hebdomadaire',
      html,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[Digest] Resend error ${res.status}: ${body}`);
    return { ok: false, error: `Resend ${res.status}` };
  }

  return { ok: true };
}
