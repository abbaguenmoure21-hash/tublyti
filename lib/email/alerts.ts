export type AlertKind = 'burn_down' | 'cron_failed' | 'silent_collection';

export interface AlertPayload {
  kind: AlertKind;
  subject: string;
  body: string;
}

export interface AlertSender {
  send(payload: AlertPayload): Promise<void>;
}
