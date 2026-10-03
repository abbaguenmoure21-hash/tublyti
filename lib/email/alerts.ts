export type AlertKind = 'burn_down' | 'cron_failed' | 'silent_collection' | 'test';

export interface AlertPayload {
  kind: AlertKind;
  subject: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
  /** Destinataire. Par défaut : ALERT_EMAIL (l'équipe TubLyTI). */
  to?: string;
}

export interface AlertSender {
  send(payload: AlertPayload): Promise<void>;
}
